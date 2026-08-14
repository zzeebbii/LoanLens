import type { DayCountConvention, LocalDate, YearMonth } from '@/domain/dates'
import type { Money, RoundingMode } from '@/domain/money'

/**
 * The loan itself: everything that does not change month to month.
 *
 * Anything a lender might do differently is an explicit, named field rather than a
 * constant buried in the engine — day count, rounding, the reference floor, when the
 * rate resets. The user's own loan agreement is the source of truth for all of them,
 * and a value we cannot verify should be visible and adjustable, not guessed at.
 */

/** EURIBOR maturities published by the ECB. */
export const TENORS = ['1M', '3M', '6M', '12M'] as const

export type Tenor = (typeof TENORS)[number]

/**
 * Repayment shapes.
 *
 * Only `ANNUITY` is implemented. The strategy interface in `amortization/` is the
 * extension point: adding equal-principal or fixed-instalment repayment means adding a
 * strategy and a member here, and touching nothing in `schedule.ts`.
 */
export const AMORTIZATION_TYPES = ['ANNUITY'] as const

export type AmortizationType = (typeof AMORTIZATION_TYPES)[number]

/** Which published series a floating rate follows. */
export interface ReferenceIndex {
  /** Identifier of the `RateProvider` that can supply this series, e.g. `'ecb'`. */
  readonly providerId: string
  readonly tenor: Tenor
}

/**
 * Rounding applied to the *rate* before it is used, distinct from rounding applied to
 * amounts. Lenders commonly publish the applied rate to three decimal places of a
 * percent, and the difference compounds over the term.
 */
export interface RateRounding {
  /** Decimal places, expressed on the percentage (3 means 2.855%). */
  readonly decimals: number
  readonly mode: RoundingMode
}

/**
 * An interest rate cap — the product a bank sells as protection against rate rises.
 *
 * The bank puts a ceiling on the reference rate for a fixed term, and charges for it. It is
 * insurance: worth its price only if rates rise far enough, for long enough, to save more
 * than the premium costs. Deciding that is exactly what this app can answer, so the cap is
 * modelled both as a term of a loan you already have and as a `RATE_CAP` scenario event for
 * one you are being offered.
 *
 * Three things about the shape are load-bearing:
 *
 * **The ceiling is on the reference, not on the total rate.** A cap protects against the
 * index moving; the margin you agreed is yours to pay regardless. This matches how the floor
 * works in this model and how these are quoted — "EURIBOR capped at 3%". If an agreement
 * instead caps the all-in rate, the ceiling entered here must be that figure minus the
 * margin, and the UI says so.
 *
 * **It has a term.** Banks sell caps for three, five or ten years, not for the life of the
 * loan. A cap modelled as permanent would overstate its value enormously, because the
 * protection would appear to cover exactly the distant years in which rates are least
 * predictable.
 *
 * **The premium is charged as rate, while the cap is in force.** Lenders usually fold the
 * price into the margin — "+0.35 percentage points for the capped period" — so it is carried
 * here in basis points, the same unit as the margin, and stops when the cap expires.
 */
export interface RateCap {
  /** Ceiling on the *reference* rate, as a fraction. 3% is `0.03`. */
  readonly ceiling: number
  /**
   * What the bank charges, in basis points added to the rate while the cap is in force.
   * 0.35 percentage points is `35`. Zero is legitimate — some caps are promotional.
   */
  readonly premiumBps: number
  readonly from: YearMonth
  /** `null` means the cap runs to the end of the loan. */
  readonly until: YearMonth | null
}

export type RateBasis =
  | {
      readonly kind: 'FIXED'
      /** Annual rate as a fraction: 3.4% is `0.034`. */
      readonly annualRate: number
    }
  | {
      readonly kind: 'FLOATING'
      readonly reference: ReferenceIndex
      /** Margin over the reference, in basis points. 0.55% is `55`. */
      readonly marginBps: number
      /**
       * Lower bound applied to the *reference* before the margin is added, as a
       * fraction. Many euro-area agreements floor it at `0`, which is why 2015-2021
       * borrowers did not benefit from negative EURIBOR. `null` means no floor.
       */
      readonly referenceFloor: number | null
      /** A cap already agreed with the lender. `null` for an uncapped loan. */
      readonly cap: RateCap | null
      /** Months between rate resets. Usually matches the tenor: 12 for 12M EURIBOR. */
      readonly resetMonths: number
      /** The first period in which the rate is reset. */
      readonly firstResetPeriod: YearMonth
      readonly rateRounding: RateRounding | null
    }

export interface Fees {
  /** Servicing fee charged with every instalment. */
  readonly monthlyServicing: Money
  /** One-off fee charged when the rate resets, if the lender levies one. */
  readonly perRateReset: Money
}

export interface Loan {
  readonly id: string
  /** User-chosen label. Not translated — it is the user's own text. */
  readonly name: string
  /** ISO 4217 code. Used for formatting only; the engine is currency-agnostic. */
  readonly currency: string
  readonly principal: Money
  /** When the money was drawn down. Interest accrues from here to the first payment. */
  readonly drawdownDate: LocalDate
  readonly firstPaymentPeriod: YearMonth
  /** Day of month the instalment falls due, clamped to shorter months. */
  readonly paymentDay: number
  readonly termMonths: number
  readonly amortization: AmortizationType
  readonly rateBasis: RateBasis
  readonly fees: Fees
  readonly dayCount: DayCountConvention
  /** Rounding applied to monetary results — interest, instalments, allocations. */
  readonly rounding: RoundingMode
}

/** Basis points to a fraction: `55` becomes `0.0055`. */
export function bpsToRate(basisPoints: number): number {
  return basisPoints / 10_000
}

/** A fraction to basis points: `0.0055` becomes `55`. */
export function rateToBps(rate: number): number {
  return rate * 10_000
}

/**
 * Rounds a rate to a number of decimal places expressed on the percentage.
 *
 * Works on the percentage rather than the fraction because that is how lenders state
 * the rule ("rounded to three decimals"), and translating it here keeps the caller
 * from having to think in fractions-of-a-fraction.
 */
export function roundRate(rate: number, rounding: RateRounding): number {
  const scale = 10 ** rounding.decimals
  const asPercent = rate * 100 * scale

  // Scaling a fraction to a percentage introduces float error: `0.034 * 100 * 100` is
  // 340.00000000000006, not 340. Under `UP` that phantom remainder rounds an
  // already-exact rate up by a whole increment, so an agreement specifying "rounded up
  // to two decimals" would add a basis point to every rate that needed no rounding.
  // Snapping values that are within float noise of an integer removes the artefact
  // without touching any remainder a lender would recognise as real.
  const nearestInteger = Math.round(asPercent)
  const noiseTolerance = Math.max(1e-9, Math.abs(asPercent) * 1e-12)
  if (Math.abs(asPercent - nearestInteger) <= noiseTolerance) {
    return nearestInteger / scale / 100
  }

  const truncated = Math.trunc(asPercent)
  const remainder = Math.abs(asPercent - truncated)
  const sign = asPercent < 0 ? -1 : 1
  // A rate that is decimally a tie — 3.445% at two decimals — lands a hair either side
  // of .5 once scaled, so an exact `=== 0.5` comparison would decide half-way cases by
  // float noise instead of by the requested mode.
  const isTie = Math.abs(remainder - 0.5) <= noiseTolerance

  let result: number
  switch (rounding.mode) {
    case 'DOWN': {
      result = truncated
      break
    }
    case 'UP': {
      result = truncated + sign
      break
    }
    case 'HALF_UP': {
      result = isTie || remainder > 0.5 ? truncated + sign : truncated
      break
    }
    case 'HALF_EVEN': {
      if (isTie) result = truncated % 2 === 0 ? truncated : truncated + sign
      else result = remainder > 0.5 ? truncated + sign : truncated
      break
    }
  }

  return result / scale / 100
}

/** What a cap does to one period, once the caps in force have been combined. */
export interface AppliedCap {
  /** Ceiling on the reference rate. */
  readonly ceiling: number
  /** Premium as a fraction, added to the rate. */
  readonly premiumRate: number
}

export interface EffectiveRate {
  /** The rate charged: clamped reference, plus margin, plus any cap premium. */
  readonly rate: number
  /** The reference after the floor and ceiling — what the rate was actually built from. */
  readonly clampedReference: number
  /** True when the ceiling bound, i.e. the fixing was above it. */
  readonly capped: boolean
  /** The premium included in `rate`, as a fraction. Zero when no cap is in force. */
  readonly premiumRate: number
}

/**
 * The rate actually charged, given a reference fixing and any cap in force.
 *
 * Order of operations, all of it deliberate:
 *
 * 1. **Floor, then ceiling, applied to the reference** — before the margin. That is the order
 *    euro-area agreements use, and flooring or capping the *total* instead would produce
 *    materially different payments. The floor is applied first, so if a nonsensical
 *    combination reaches here (ceiling below floor) the floor wins — a contractual minimum
 *    you owe should not be undercut by protection you bought. `assertValidLoan` rejects that
 *    combination outright, so it should never arrive.
 * 2. **Margin.**
 * 3. **Cap premium** — what the bank charges for the ceiling, on top of everything. It is
 *    priced as a margin increase, so it sits where a margin increase would.
 * 4. **Rounding**, applied to the finished rate.
 */
export function effectiveRate(
  basis: Extract<RateBasis, { kind: 'FLOATING' }>,
  referenceRate: number,
  cap: AppliedCap | null = null,
): EffectiveRate {
  const floor = basis.referenceFloor
  const floored = floor === null ? referenceRate : Math.max(referenceRate, floor)

  // Ceiling, then the floor once more. The second application is what makes the floor win a
  // contradictory pair: without it, `min` would pull the reference below a minimum the
  // borrower contractually owes. In every sane arrangement — ceiling above floor — the
  // re-application changes nothing.
  const ceilinged = cap === null ? floored : Math.min(floored, cap.ceiling)
  const clampedReference = floor === null ? ceilinged : Math.max(ceilinged, floor)

  const premiumRate = cap?.premiumRate ?? 0
  const combined = clampedReference + bpsToRate(basis.marginBps) + premiumRate

  return {
    // Rounded last, so the premium is inside the rounded figure rather than added to it.
    rate: basis.rateRounding === null ? combined : roundRate(combined, basis.rateRounding),
    clampedReference,
    // True only when the ceiling actually reduced the rate. A ceiling that sits below the
    // floor never bites, because the floor holds the reference above it anyway.
    capped: cap !== null && clampedReference < floored,
    premiumRate,
  }
}

/**
 * Combines every cap in force for a period into the one that applies.
 *
 * The tightest ceiling wins and premiums add up. Overlapping caps are not a normal
 * arrangement — you would hold one — but a scenario laid over a loan that already has one
 * produces exactly that, and the rule has to be predictable. Taking the lowest ceiling
 * matches what protection means, and summing premiums matches having paid for both.
 *
 * @returns `null` when nothing is in force, which is the common case.
 */
export function combineCaps(caps: readonly RateCap[]): AppliedCap | null {
  if (caps.length === 0) return null

  return {
    ceiling: Math.min(...caps.map((cap) => cap.ceiling)),
    premiumRate: caps.reduce((total, cap) => total + bpsToRate(cap.premiumBps), 0),
  }
}
