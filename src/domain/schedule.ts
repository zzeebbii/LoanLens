import type { LocalDate, YearMonth } from '@/domain/dates'
import type { AppliedCap, Loan, RateCap, ReferenceIndex } from '@/domain/loan'
import type { Money } from '@/domain/money'
import type { LoanEvent } from '@/domain/scenario'

import { strategyFor } from '@/domain/amortization'
import {
  addMonths,
  MONTHS_PER_YEAR,
  monthsBetween,
  paymentDateFor,
  yearFraction,
} from '@/domain/dates'
import { combineCaps, effectiveRate } from '@/domain/loan'
import { add, isPositive, min, multiplyByRate, subtract, sum, ZERO } from '@/domain/money'
import {
  balanceCorrectionFor,
  extraPaymentsFor,
  holidayFor,
  periodInRange,
  rateCapsFor,
  rateOverrideFor,
} from '@/domain/scenario'

/**
 * The engine: replays a loan month by month and returns what was, or will be, paid.
 *
 * Pure and synchronous. Rates arrive as an injected function, so this module has no
 * idea the ECB exists and every run is deterministic — see
 * docs/adr/0001-pure-domain-engine-with-injected-rates.md.
 */

/** Supplies the reference fixing for a period, or `null` if none is known. */
export type ReferenceRateAt = (period: YearMonth, index: ReferenceIndex) => number | null

export const PAYMENT_FLAGS = [
  'RATE_RESET',
  'RATE_CAPPED',
  'PAYMENT_RECALCULATED',
  'PAYMENT_HOLIDAY',
  'INTEREST_CAPITALISED',
  'NEGATIVE_AMORTIZATION',
  'EXTRA_PAYMENT',
  'BALANCE_CORRECTED',
  'FINAL_PAYMENT',
  'BEYOND_ORIGINAL_TERM',
] as const

export type PaymentFlag = (typeof PAYMENT_FLAGS)[number]

/** One instalment. Every table, total and chart in the app derives from these. */
export interface PaymentRow {
  /** 1-based position in the schedule. */
  readonly index: number
  readonly period: YearMonth
  readonly dueDate: LocalDate
  readonly openingBalance: Money
  /** Annual rate applied for this period, as a fraction. */
  readonly annualRate: number
  /** The underlying fixing, before floor, ceiling and margin. `null` for fixed-rate loans. */
  readonly referenceRate: number | null
  /** The ceiling in force this period, or `null` when no cap applies. */
  readonly capCeiling: number | null
  /**
   * The part of this period's interest that is the cap premium.
   *
   * Carried separately because it answers the question a cap raises: it cost this much, did
   * it save more? Netted into `interest` it would be invisible, and the saving cannot be
   * read off a single schedule anyway — that needs the uncapped comparison.
   */
  readonly capPremium: Money
  /** The level instalment targeted this period — capital plus interest, before fees. */
  readonly scheduledInstalment: Money
  /** Interest actually paid this period. */
  readonly interest: Money
  /** Interest added to the balance instead of being paid. */
  readonly capitalisedInterest: Money
  readonly capital: Money
  readonly extraPayment: Money
  readonly fees: Money
  /** Everything leaving the borrower's account: interest + capital + extra + fees. */
  readonly totalPaid: Money
  readonly closingBalance: Money
  readonly flags: readonly PaymentFlag[]
}

export interface ReplayInput {
  readonly loan: Loan
  readonly referenceRateAt: ReferenceRateAt
  readonly events?: readonly LoanEvent[]
  /**
   * Hard stop, guarding against a schedule that never amortises (an instalment that
   * cannot cover the interest, for instance). Defaults to the term plus ten years.
   */
  readonly maxPeriods?: number
}

/**
 * Thrown when the engine needs a fixing the caller did not supply.
 *
 * The engine will not invent a rate for a future month. Choosing what happens next —
 * hold the last known rate, follow a curve, stress it upward — is a modelling
 * assumption the user should see and control, so it belongs above this layer.
 */
export class MissingRateError extends Error {
  constructor(
    readonly period: YearMonth,
    readonly index: ReferenceIndex,
  ) {
    super(
      `No ${index.tenor} rate available from provider "${index.providerId}" for ${period}. ` +
        'Supply a forecast assumption for periods beyond the published data.',
    )
    this.name = 'MissingRateError'
  }
}

/** Thrown when a loan cannot amortise within `maxPeriods`. */
export class NonAmortizingLoanError extends Error {
  constructor(
    readonly periodsElapsed: number,
    readonly remainingBalance: Money,
  ) {
    super(
      `Loan did not amortise within ${periodsElapsed} periods; ${remainingBalance} minor units remain. ` +
        'The instalment is probably too small to cover the interest.',
    )
    this.name = 'NonAmortizingLoanError'
  }
}

function assertValidLoan(loan: Loan): void {
  if (!Number.isInteger(loan.termMonths) || loan.termMonths < 1) {
    throw new RangeError(
      `Term must be a positive whole number of months, received ${loan.termMonths}.`,
    )
  }
  if (loan.principal <= ZERO) {
    throw new RangeError('Principal must be positive.')
  }
  if (loan.rateBasis.kind === 'FLOATING') {
    const { resetMonths, referenceFloor, cap } = loan.rateBasis
    if (!Number.isInteger(resetMonths) || resetMonths < 1) {
      throw new RangeError(
        `Reset interval must be a positive whole number of months, received ${resetMonths}.`,
      )
    }

    if (cap !== null) {
      if (!Number.isFinite(cap.ceiling)) {
        throw new RangeError(`Rate cap ceiling must be a finite number, received ${cap.ceiling}.`)
      }
      if (!Number.isFinite(cap.premiumBps) || cap.premiumBps < 0) {
        throw new RangeError(
          `Rate cap premium must be zero or more basis points, received ${cap.premiumBps}.`,
        )
      }
      // A ceiling beneath the floor describes an agreement that cannot exist: protection
      // that can never pay out, sold for a premium that is charged regardless. Rejected here
      // rather than silently resolved, because either resolution would be a guess about what
      // the user meant.
      if (referenceFloor !== null && cap.ceiling < referenceFloor) {
        throw new RangeError(
          `Rate cap ceiling ${cap.ceiling} is below the reference floor ${referenceFloor}. ` +
            'The cap could never take effect, and the premium would be charged for nothing.',
        )
      }
      if (cap.until !== null && cap.until < cap.from) {
        throw new RangeError(`Rate cap ends (${cap.until}) before it starts (${cap.from}).`)
      }
    }
  }
}

/**
 * True when the applied rate is refreshed from the reference in this period.
 *
 * Resets fall on a fixed cadence from `firstResetPeriod` — every twelfth month for a
 * 12M-linked loan — and not on the payment anniversary, which is a distinction real
 * agreements make and borrowers routinely get wrong.
 */
function isResetPeriod(loan: Loan, period: YearMonth): boolean {
  if (loan.rateBasis.kind !== 'FLOATING') return false
  const elapsed = monthsBetween(loan.rateBasis.firstResetPeriod, period)
  return elapsed >= 0 && elapsed % loan.rateBasis.resetMonths === 0
}

/**
 * Every cap in force for a period: the loan's own, plus any a scenario adds.
 *
 * A loan-level cap is still range-checked. Caps are sold for a fixed term, so one that has
 * expired must stop applying — and stop being charged for.
 */
function capsInForce(loan: Loan, period: YearMonth, events: readonly LoanEvent[]): RateCap[] {
  const fromLoan =
    loan.rateBasis.kind === 'FLOATING' &&
    loan.rateBasis.cap !== null &&
    periodInRange(period, loan.rateBasis.cap.from, loan.rateBasis.cap.until)
      ? [loan.rateBasis.cap]
      : []

  return [...fromLoan, ...rateCapsFor(period, events)]
}

interface ResolvedRate {
  readonly annualRate: number
  readonly referenceRate: number | null
  readonly capCeiling: number | null
  readonly capped: boolean
  readonly premiumRate: number
}

/** The rate this period, before any override: fixed, or reference + floor + ceiling + margin. */
function rateFromBasis(
  loan: Loan,
  period: YearMonth,
  referenceRateAt: ReferenceRateAt,
  cap: AppliedCap | null,
): ResolvedRate {
  if (loan.rateBasis.kind === 'FIXED') {
    // A cap on a fixed rate is meaningless — there is no reference to cap, and charging a
    // premium for protection that cannot bind would be a pure loss.
    return {
      annualRate: loan.rateBasis.annualRate,
      referenceRate: null,
      capCeiling: null,
      capped: false,
      premiumRate: 0,
    }
  }

  const reference = referenceRateAt(period, loan.rateBasis.reference)
  if (reference === null) {
    throw new MissingRateError(period, loan.rateBasis.reference)
  }

  const resolved = effectiveRate(loan.rateBasis, reference, cap)

  return {
    annualRate: resolved.rate,
    // The raw fixing, not the clamped one. A reader comparing against a published EURIBOR
    // needs to see what it actually was; the `RATE_CAPPED` flag says what we did about it.
    referenceRate: reference,
    capCeiling: cap?.ceiling ?? null,
    capped: resolved.capped,
    premiumRate: resolved.premiumRate,
  }
}

/**
 * Replays a loan, one row per instalment, until the balance reaches exactly zero.
 *
 * The schedule may run a period past the nominal term. That is not a defect: rounding
 * each instalment to the cent leaves a small residue, and real lenders settle it with a
 * final adjusting payment rather than by shifting every earlier instalment.
 */
export function replay({
  loan,
  referenceRateAt,
  events = [],
  maxPeriods,
}: ReplayInput): PaymentRow[] {
  assertValidLoan(loan)

  const strategy = strategyFor(loan.amortization)
  const limit = maxPeriods ?? loan.termMonths + 10 * MONTHS_PER_YEAR

  const rows: PaymentRow[] = []
  let balance = loan.principal
  let period = loan.firstPaymentPeriod
  // Interest for the first period accrues from drawdown, which is usually not a
  // payment date and may be a partial period.
  let previousDueDate = loan.drawdownDate
  let instalment: Money | null = null
  let currentRate = Number.NaN
  let currentReference: number | null = null
  let currentCapCeiling: number | null = null
  let currentPremiumRate = 0
  let currentlyCapped = false
  let overrideWasActive = false
  let holidayWasActive = false
  // Identifies the cap arrangement, so a cap starting, ending or changing is detectable.
  let previousCapSignature: string | null = null

  for (let index = 1; isPositive(balance) && index <= limit; index += 1) {
    const flags: PaymentFlag[] = []
    const dueDate = paymentDateFor(period, loan.paymentDay)
    const openingBalance = balance

    // ---- rate for this period -------------------------------------------------
    const override = rateOverrideFor(period, events)
    const isReset = isResetPeriod(loan, period)
    const cap = combineCaps(capsInForce(loan, period, events))

    /*
     * A cap starting or expiring changes the rate even in a month that is not a scheduled
     * reset — the ceiling stops binding and the premium stops being charged on the same day.
     * Without this the rate would stay frozen at its last reset value until the next one,
     * which would keep charging for protection that had already lapsed.
     */
    const capSignature = cap === null ? null : `${cap.ceiling}:${cap.premiumRate}`
    const capArrangementChanged = capSignature !== previousCapSignature
    previousCapSignature = capSignature

    let rateChanged = false

    if (override !== null) {
      if (override !== currentRate) rateChanged = true
      currentRate = override
      currentReference = null
      currentCapCeiling = null
      currentPremiumRate = 0
      currentlyCapped = false
      overrideWasActive = true
    } else if (index === 1 || isReset || overrideWasActive || capArrangementChanged) {
      // `overrideWasActive` matters on the period an override lapses: without it the
      // overridden rate would stick until the next scheduled reset, silently extending
      // a what-if assumption past the range the user drew.
      const resolved = rateFromBasis(loan, period, referenceRateAt, cap)
      if (resolved.annualRate !== currentRate) rateChanged = true
      currentRate = resolved.annualRate
      currentReference = resolved.referenceRate
      currentCapCeiling = resolved.capCeiling
      currentPremiumRate = resolved.premiumRate
      currentlyCapped = resolved.capped
      overrideWasActive = false
    }

    if (currentlyCapped) flags.push('RATE_CAPPED')

    if (isReset && index > 1) flags.push('RATE_RESET')

    // ---- instalment -----------------------------------------------------------
    // Sized over the periods remaining in the *original* term, so a rate change moves
    // the payment and leaves the payoff date alone. An overpayment made to shorten the
    // term does not enter here at all: the instalment holds and the loop simply ends
    // earlier.
    const remainingPeriods = Math.max(1, loan.termMonths - (index - 1))
    const holiday = holidayFor(period, events)

    // A holiday leaves the balance higher (or at best unchanged) with fewer periods
    // left to clear it, so the old instalment no longer amortises the loan. Lenders
    // resize the payment when a holiday ends, and so does this — which is also what
    // keeps an annuity loan from drifting into negative amortisation afterwards.
    const holidayJustEnded = holiday === null && holidayWasActive

    if (instalment === null || rateChanged || holidayJustEnded) {
      instalment = strategy.instalment({
        balance,
        periodicRate: currentRate / MONTHS_PER_YEAR,
        remainingPeriods,
        rounding: loan.rounding,
      })
      if (index > 1) flags.push('PAYMENT_RECALCULATED')
    }

    // Captured before the end-of-period resize below, so the row reports the
    // instalment that applied *this* period rather than next period's.
    const instalmentThisPeriod = instalment

    // ---- interest -------------------------------------------------------------
    const accrualFactor = yearFraction(previousDueDate, dueDate, loan.dayCount)
    const interestDue = multiplyByRate(balance, currentRate * accrualFactor, loan.rounding)

    /*
     * The premium portion, computed at the same balance and accrual factor as the interest
     * it is part of — so it is the exact amount the cap added this period, not an estimate.
     * It is a component of `interestDue`, never an addition to it.
     */
    const capPremium =
      currentPremiumRate === 0
        ? ZERO
        : multiplyByRate(balance, currentPremiumRate * accrualFactor, loan.rounding)

    // ---- apply the payment ----------------------------------------------------
    holidayWasActive = holiday !== null
    let interestPaid: Money
    let capitalisedInterest = ZERO
    let capital: Money

    if (holiday === null) {
      // If the instalment cannot even cover the interest, the loan is amortising
      // backwards. Rather than emit a negative capital figure, pay what the instalment
      // covers and capitalise the shortfall, which is what actually happens.
      //
      // Defensive for annuity repayment: the instalment is resized on every rate
      // change and when a holiday ends, so it should always cover the interest. It is
      // what guarantees `capital >= 0` regardless, and it is the path a
      // fixed-instalment strategy — where the payment deliberately does not move —
      // would take for real.
      interestPaid = min(instalmentThisPeriod, interestDue)
      capitalisedInterest = subtract(interestDue, interestPaid)
      capital = subtract(instalmentThisPeriod, interestPaid)

      if (isPositive(capitalisedInterest)) flags.push('NEGATIVE_AMORTIZATION')
    } else {
      flags.push('PAYMENT_HOLIDAY')
      capital = ZERO
      if (holiday === 'PAY') {
        interestPaid = interestDue
      } else {
        interestPaid = ZERO
        capitalisedInterest = interestDue
      }
    }

    if (isPositive(capitalisedInterest)) flags.push('INTEREST_CAPITALISED')

    // The last scheduled payment settles whatever is left rather than overshooting.
    const balanceWithCapitalised = add(balance, capitalisedInterest)
    capital = min(capital, balanceWithCapitalised)

    const extras = extraPaymentsFor(period, events)
    const afterCapital = subtract(balanceWithCapitalised, capital)
    const extraPayment = min(extras.total, afterCapital)
    if (isPositive(extraPayment)) flags.push('EXTRA_PAYMENT')

    balance = subtract(afterCapital, extraPayment)

    // ---- fees -----------------------------------------------------------------
    const fees = isReset
      ? add(loan.fees.monthlyServicing, loan.fees.perRateReset)
      : loan.fees.monthlyServicing

    // ---- corrections ----------------------------------------------------------
    const correction = balanceCorrectionFor(period, events)
    if (correction !== null) {
      balance = correction
      flags.push('BALANCE_CORRECTED')
    }

    // An overpayment that lowers the instalment, or a correction, changes the basis —
    // so the instalment is resized from the new balance over the remaining term.
    const loweredPayment = isPositive(extras.lowerPayment) && isPositive(extraPayment)
    if ((correction !== null || loweredPayment) && isPositive(balance)) {
      instalment = strategy.instalment({
        balance,
        periodicRate: currentRate / MONTHS_PER_YEAR,
        remainingPeriods: Math.max(1, loan.termMonths - index),
        rounding: loan.rounding,
      })
    }

    if (index > loan.termMonths) flags.push('BEYOND_ORIGINAL_TERM')
    if (!isPositive(balance)) flags.push('FINAL_PAYMENT')

    rows.push({
      index,
      period,
      dueDate,
      openingBalance,
      annualRate: currentRate,
      referenceRate: currentReference,
      capCeiling: currentCapCeiling,
      // Only what was actually paid counts as premium: during a capitalising holiday no
      // interest is paid, so no premium is either.
      capPremium: min(capPremium, interestPaid),
      scheduledInstalment: instalmentThisPeriod,
      interest: interestPaid,
      capitalisedInterest,
      capital,
      extraPayment,
      fees,
      totalPaid: sum([interestPaid, capital, extraPayment, fees]),
      closingBalance: balance,
      flags,
    })

    previousDueDate = dueDate
    period = addMonths(period, 1)
  }

  if (isPositive(balance)) {
    throw new NonAmortizingLoanError(rows.length, balance)
  }

  return rows
}
