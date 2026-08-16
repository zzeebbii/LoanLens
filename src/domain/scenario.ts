import type { YearMonth } from '@/domain/dates'
import type { RateCap } from '@/domain/loan'
import type { Money } from '@/domain/money'

import { compareYearMonth } from '@/domain/dates'
import { add, ZERO } from '@/domain/money'

/**
 * Events that change how a loan plays out.
 *
 * A scenario is not a special mode in the engine — it is just a different array of
 * these. "What if I pay an extra €200 a month" and "what actually happened" run through
 * exactly the same `replay`, which is what makes comparing them meaningful.
 */

/**
 * What an extra payment buys.
 *
 * This is the distinction the whole app exists to make visible, and lenders make you
 * choose:
 *
 * - `SHORTEN_TERM` — the instalment stays put and the loan finishes sooner. Saves the
 *   most interest, because every euro of overpayment removes the interest that would
 *   have accrued on it for the entire remaining term.
 * - `LOWER_PAYMENT` — the payoff date stays put and the instalment is recalculated
 *   downward over the remaining term. Saves less interest, but frees monthly cash.
 */
export const EXTRA_PAYMENT_EFFECTS = ['SHORTEN_TERM', 'LOWER_PAYMENT'] as const

export type ExtraPaymentEffect = (typeof EXTRA_PAYMENT_EFFECTS)[number]

/** What happens to interest that falls due during a payment holiday. */
export const HOLIDAY_INTEREST_HANDLING = ['PAY', 'CAPITALISE'] as const

export type HolidayInterestHandling = (typeof HOLIDAY_INTEREST_HANDLING)[number]

export type LoanEvent =
  /** A single lump sum, paid alongside the instalment for `period`. */
  | {
      readonly kind: 'EXTRA_PAYMENT'
      readonly period: YearMonth
      readonly amount: Money
      readonly effect: ExtraPaymentEffect
    }
  /** A standing overpayment. `until` of `null` means "for the rest of the loan". */
  | {
      readonly kind: 'RECURRING_EXTRA'
      readonly from: YearMonth
      readonly until: YearMonth | null
      readonly amount: Money
      readonly effect: ExtraPaymentEffect
    }
  /**
   * Amortisation is suspended. With `PAY` the borrower still services the interest;
   * with `CAPITALISE` it is added to the balance and earns interest thereafter.
   */
  | {
      readonly kind: 'PAYMENT_HOLIDAY'
      readonly from: YearMonth
      readonly until: YearMonth
      readonly interest: HolidayInterestHandling
    }
  /**
   * Forces the applied rate, ignoring the reference. Covers a rate the app cannot
   * fetch, a negotiated rate, and stress scenarios ("what if it hits 6%").
   */
  | {
      readonly kind: 'RATE_OVERRIDE'
      readonly from: YearMonth
      readonly until: YearMonth | null
      readonly annualRate: number
    }
  /**
   * A cap on the reference rate, bought for a premium.
   *
   * The event form of `RateBasis.cap`, for the question a borrower actually faces: the bank
   * is offering a ceiling for a price — is it worth taking? Modelled as an event so the
   * answer comes from the same comparison machinery as any other what-if, with the capped
   * and uncapped schedules replayed through identical code.
   */
  | {
      readonly kind: 'RATE_CAP'
      /** Ceiling on the reference rate, as a fraction. */
      readonly ceiling: number
      /** Premium in basis points, added to the rate while the cap is in force. */
      readonly premiumBps: number
      readonly from: YearMonth
      /** `null` runs the cap to the end of the loan. */
      readonly until: YearMonth | null
    }
  /**
   * Forces the instalment, ignoring what the annuity formula would produce.
   *
   * A "variable annuity" is not recomputed continuously — the lender strikes it once, at
   * signing or at a reset, and then holds it until the next reset. So the payment on a
   * statement routinely reflects a rate that no longer applies, and cannot be derived from
   * the rate that does. A real case: a loan whose contract fixed the annuity at 897.42 when
   * the rate was 3.63%, drawn down two months later at 3.976%, where the lender charged
   * 901.37 rather than the 918.61 that rate and term imply. Nothing about the loan is
   * mis-entered; the payment is simply an input, not an output.
   *
   * Without this the difference lands entirely in capital — 17 euro a month against that
   * loan, which is a thousand euro of phantom repayment inside four years.
   */
  | {
      readonly kind: 'INSTALMENT_OVERRIDE'
      readonly from: YearMonth
      /** `null` holds it until something else resizes the payment, e.g. a rate reset. */
      readonly until: YearMonth | null
      /** Capital plus interest, before fees — the same basis as `scheduledInstalment`. */
      readonly amount: Money
    }
  /**
   * Pins the balance to a figure taken from a real statement.
   *
   * The model will drift from a lender's own numbers wherever a rounding or day-count
   * rule is not exactly reproduced. Rather than let that drift compound silently for
   * twenty years, the user can anchor the schedule to a known-good balance and have
   * everything after it recalculated from there.
   */
  | {
      readonly kind: 'BALANCE_CORRECTION'
      readonly period: YearMonth
      readonly closingBalance: Money
    }

export type LoanEventKind = LoanEvent['kind']

/**
 * A named what-if, saved against a loan.
 *
 * A scenario holds nothing but events, because that is all a scenario *is* — the engine
 * runs it through exactly the same `replay` as the baseline. There is no separate code
 * path for a projection, which is what makes comparing one to the baseline meaningful.
 */
export interface Scenario {
  readonly id: string
  readonly loanId: string
  /** The user's own label. Not translated. */
  readonly name: string
  readonly events: readonly LoanEvent[]
  /** ISO 8601 instant, for ordering the list. */
  readonly createdAt: string
}

/** The implicit scenario every loan has: the schedule with no events at all. */
export const BASELINE_SCENARIO_ID = 'baseline'

/** True if `period` falls within `[from, until]`, treating a `null` end as open. */
export function periodInRange(
  period: YearMonth,
  from: YearMonth,
  until: YearMonth | null,
): boolean {
  if (compareYearMonth(period, from) < 0) return false
  return until === null || compareYearMonth(period, until) <= 0
}

export interface ExtraPaymentsForPeriod {
  /** Overpayments that shorten the term. */
  readonly shortenTerm: Money
  /** Overpayments that reduce the instalment. */
  readonly lowerPayment: Money
  readonly total: Money
}

/**
 * Totals the overpayments landing in one period, split by effect.
 *
 * Kept split rather than summed because the two effects are applied differently: only
 * a `LOWER_PAYMENT` overpayment triggers an instalment recalculation.
 */
export function extraPaymentsFor(
  period: YearMonth,
  events: readonly LoanEvent[],
): ExtraPaymentsForPeriod {
  let shortenTerm = ZERO
  let lowerPayment = ZERO

  for (const event of events) {
    let amount: Money | null = null
    let effect: ExtraPaymentEffect | null = null

    if (event.kind === 'EXTRA_PAYMENT' && event.period === period) {
      amount = event.amount
      effect = event.effect
    } else if (event.kind === 'RECURRING_EXTRA' && periodInRange(period, event.from, event.until)) {
      amount = event.amount
      effect = event.effect
    }

    if (amount === null || effect === null) continue
    if (effect === 'SHORTEN_TERM') shortenTerm = add(shortenTerm, amount)
    else lowerPayment = add(lowerPayment, amount)
  }

  return { shortenTerm, lowerPayment, total: add(shortenTerm, lowerPayment) }
}

/** The holiday covering `period`, if any. */
export function holidayFor(
  period: YearMonth,
  events: readonly LoanEvent[],
): HolidayInterestHandling | null {
  for (const event of events) {
    if (event.kind === 'PAYMENT_HOLIDAY' && periodInRange(period, event.from, event.until)) {
      return event.interest
    }
  }
  return null
}

/**
 * The rate override in force for `period`, if any.
 *
 * Later events win, so a user can layer a correction over a broad assumption without
 * having to edit the original.
 */
export function rateOverrideFor(period: YearMonth, events: readonly LoanEvent[]): number | null {
  let override: number | null = null
  for (const event of events) {
    if (event.kind === 'RATE_OVERRIDE' && periodInRange(period, event.from, event.until)) {
      override = event.annualRate
    }
  }
  return override
}

/**
 * The instalment an event forces for `period`, if any.
 *
 * Last writer wins, like `rateOverrideFor`, so a scenario laid over a loan's own history can
 * correct an earlier correction without the earlier one having to be edited out.
 */
export function instalmentOverrideFor(
  period: YearMonth,
  events: readonly LoanEvent[],
): Money | null {
  let override: Money | null = null
  for (const event of events) {
    if (event.kind === 'INSTALMENT_OVERRIDE' && periodInRange(period, event.from, event.until)) {
      override = event.amount
    }
  }
  return override
}

/**
 * Every rate cap an event puts in force for `period`.
 *
 * Returns all of them rather than one, because the caller combines them with any cap the
 * loan itself carries — and combining is not "pick one": the tightest ceiling binds and the
 * premiums add. See `combineCaps`.
 */
export function rateCapsFor(period: YearMonth, events: readonly LoanEvent[]): RateCap[] {
  const caps: RateCap[] = []

  for (const event of events) {
    if (event.kind === 'RATE_CAP' && periodInRange(period, event.from, event.until)) {
      caps.push({
        ceiling: event.ceiling,
        premiumBps: event.premiumBps,
        from: event.from,
        until: event.until,
      })
    }
  }

  return caps
}

/** The balance correction anchored to `period`, if any. Later events win. */
export function balanceCorrectionFor(
  period: YearMonth,
  events: readonly LoanEvent[],
): Money | null {
  let correction: Money | null = null
  for (const event of events) {
    if (event.kind === 'BALANCE_CORRECTION' && event.period === period) {
      correction = event.closingBalance
    }
  }
  return correction
}
