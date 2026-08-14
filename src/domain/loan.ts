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

/**
 * The rate actually charged, given a reference fixing.
 *
 * Applies the floor to the reference *before* the margin, which is the order euro-area
 * agreements use — flooring the total instead would have produced materially different
 * payments during the negative-rate years.
 */
export function effectiveRate(
  basis: Extract<RateBasis, { kind: 'FLOATING' }>,
  referenceRate: number,
): number {
  const floored =
    basis.referenceFloor === null ? referenceRate : Math.max(referenceRate, basis.referenceFloor)
  const combined = floored + bpsToRate(basis.marginBps)
  return basis.rateRounding === null ? combined : roundRate(combined, basis.rateRounding)
}
