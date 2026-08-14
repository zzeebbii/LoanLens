import type { DayCountConvention, YearMonth } from '@/domain/dates'
import type { Loan, RateRounding } from '@/domain/loan'
import type { Money, RoundingMode } from '@/domain/money'
import type { ReferenceRateAt } from '@/domain/schedule'

import { localDate, yearMonth } from '@/domain/dates'
import { fromMajorUnits, ZERO } from '@/domain/money'

/**
 * Loan fixtures for tests.
 *
 * Lives in `domain/` rather than a test-only folder so the boundary check covers it —
 * fixtures that could import React would be a hole in the rule they are meant to help
 * verify. Kept out of coverage reporting by `vitest.config.ts`.
 *
 * The defaults describe a plausible Finnish mortgage: 250,000 over 25 years, drawn down
 * in February 2021, paying on the 15th, tracking 12M EURIBOR plus 55bp with an annual
 * reset each March.
 */

export interface FixedRateLoanOverrides {
  readonly principal?: Money
  readonly termMonths?: number
  readonly annualRate?: number
  readonly paymentDay?: number
  readonly dayCount?: DayCountConvention
  readonly rounding?: RoundingMode
  readonly monthlyServicing?: Money
  readonly perRateReset?: Money
  readonly drawdownDate?: Loan['drawdownDate']
  readonly firstPaymentPeriod?: YearMonth
}

export function fixedRateLoan(overrides: FixedRateLoanOverrides = {}): Loan {
  return {
    id: 'fixture-fixed',
    name: 'Fixture (fixed)',
    currency: 'EUR',
    principal: overrides.principal ?? fromMajorUnits(250_000),
    drawdownDate: overrides.drawdownDate ?? localDate(2021, 2, 15),
    firstPaymentPeriod: overrides.firstPaymentPeriod ?? yearMonth(2021, 3),
    paymentDay: overrides.paymentDay ?? 15,
    termMonths: overrides.termMonths ?? 300,
    amortization: 'ANNUITY',
    rateBasis: { kind: 'FIXED', annualRate: overrides.annualRate ?? 0.034 },
    fees: {
      monthlyServicing: overrides.monthlyServicing ?? ZERO,
      perRateReset: overrides.perRateReset ?? ZERO,
    },
    dayCount: overrides.dayCount ?? 'MONTHLY_NOMINAL',
    rounding: overrides.rounding ?? 'HALF_UP',
  }
}

export interface FloatingRateLoanOverrides extends FixedRateLoanOverrides {
  readonly marginBps?: number
  readonly referenceFloor?: number | null
  readonly resetMonths?: number
  readonly firstResetPeriod?: YearMonth
  readonly rateRounding?: RateRounding | null
}

export function floatingRateLoan(overrides: FloatingRateLoanOverrides = {}): Loan {
  return {
    ...fixedRateLoan(overrides),
    id: 'fixture-floating',
    name: 'Fixture (floating)',
    rateBasis: {
      kind: 'FLOATING',
      reference: { providerId: 'test', tenor: '12M' },
      marginBps: overrides.marginBps ?? 55,
      referenceFloor: overrides.referenceFloor === undefined ? 0 : overrides.referenceFloor,
      resetMonths: overrides.resetMonths ?? 12,
      firstResetPeriod: overrides.firstResetPeriod ?? yearMonth(2021, 3),
      rateRounding: overrides.rateRounding ?? null,
    },
  }
}

/**
 * A resolver for fixed-rate fixtures, which never ask for a reference fixing.
 *
 * Throws rather than returning `null` so that a test which accidentally uses it with a
 * floating-rate loan fails loudly instead of surfacing as a confusing `MissingRateError`.
 */
export const noRates: ReferenceRateAt = () => {
  throw new Error('This fixture is fixed-rate and should never request a reference fixing.')
}

/**
 * Builds a resolver from a sparse map of fixings, carrying the most recent one forward.
 *
 * Carrying forward mirrors how a reference series behaves in practice: a fixing is
 * published monthly, and a loan resetting every twelve months only ever reads a few of
 * them. Periods before the earliest entry resolve to `null`, so tests can exercise the
 * missing-rate path.
 */
export function rateOf(fixings: Readonly<Record<string, number>>): ReferenceRateAt {
  const sorted = Object.keys(fixings).toSorted()

  return (period: YearMonth) => {
    let resolved: number | null = null
    for (const key of sorted) {
      if (key <= period) resolved = fixings[key] ?? null
      else break
    }
    return resolved
  }
}
