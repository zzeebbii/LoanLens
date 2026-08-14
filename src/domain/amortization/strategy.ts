import type { AmortizationType } from '@/domain/loan'
import type { Money, RoundingMode } from '@/domain/money'

/**
 * The extension point for repayment shapes.
 *
 * `schedule.ts` walks the calendar, accrues interest and applies events; it never
 * decides how large the instalment is. That single question is what a strategy answers,
 * which is why adding equal-principal or fixed-instalment repayment later needs no
 * change to the schedule walk.
 */

export interface InstalmentInput {
  /** Balance the instalment must amortise. */
  readonly balance: Money
  /**
   * Rate per period used for *sizing* the instalment — the nominal annual rate divided
   * by twelve.
   *
   * Deliberately not the same as the rate used to accrue each period's interest. A
   * lender computing interest on ACT/360 still sizes the annuity off a nominal monthly
   * rate; otherwise the instalment would change every month with the length of the
   * month, and an annuity loan would not have a constant payment at all.
   */
  readonly periodicRate: number
  /** Periods left in which to repay the balance. Always at least 1. */
  readonly remainingPeriods: number
  readonly rounding: RoundingMode
}

export interface AmortizationStrategy {
  readonly type: AmortizationType
  /**
   * The scheduled instalment — capital plus interest, excluding fees.
   *
   * Called on the first period and again whenever the basis changes: a rate reset, an
   * overpayment that lowers the payment, or a balance correction.
   */
  instalment(input: InstalmentInput): Money
}
