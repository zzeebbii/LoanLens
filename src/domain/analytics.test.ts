import type { LoanEvent } from '@/domain/scenario'

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  breakEven,
  byYear,
  compareToBaseline,
  crossoverPeriod,
  progressToDate,
  runningTotals,
  totals,
} from '@/domain/analytics'
import { yearMonth } from '@/domain/dates'
import { add, fromMajorUnits, isZero, sum, toCents, ZERO } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { fixedRateLoan, noRates } from '@/domain/testing/fixtures'

const loan = fixedRateLoan()
const baseline = replay({ loan, referenceRateAt: noRates })

const extra200: LoanEvent[] = [
  {
    kind: 'RECURRING_EXTRA',
    from: yearMonth(2021, 3),
    until: null,
    amount: fromMajorUnits(200),
    effect: 'SHORTEN_TERM',
  },
]
const shortened = replay({ loan, referenceRateAt: noRates, events: extra200 })

describe('totals', () => {
  it('recovers the original principal and matches the reference interest', () => {
    const summary = totals(baseline)
    expect(summary.principal).toBe(loan.principal)
    expect(toCents(summary.interest)).toBe(12_145_749n)
    expect(summary.periods).toBe(301)
    expect(summary.firstPeriod).toBe(yearMonth(2021, 3))
    expect(summary.payoffPeriod).toBe(yearMonth(2046, 3))
  })

  it('reports interest as a share of principal', () => {
    // 121,457.49 of interest on 250,000 borrowed — just under half again.
    expect(totals(baseline).interestRatio).toBeCloseTo(0.4858, 3)
  })

  it('accounts for every cent: total paid = principal + interest + fees', () => {
    const withFees = replay({
      loan: fixedRateLoan({ monthlyServicing: fromMajorUnits(2.5) }),
      referenceRateAt: noRates,
    })
    const summary = totals(withFees)
    expect(summary.totalPaid).toBe(sum([summary.principal, summary.interest, summary.fees]))
  })

  it('recovers the principal even when interest was capitalised', () => {
    // Capitalised interest inflates the capital column; netting it off must give the
    // original borrowing back, otherwise the "principal" figure is meaningless.
    const rows = replay({
      loan,
      referenceRateAt: noRates,
      events: [
        {
          kind: 'PAYMENT_HOLIDAY',
          from: yearMonth(2022, 1),
          until: yearMonth(2022, 12),
          interest: 'CAPITALISE',
        },
      ],
    })
    expect(totals(rows).principal).toBe(loan.principal)
  })

  it('handles an empty schedule without dividing by zero', () => {
    const summary = totals([])
    expect(summary.periods).toBe(0)
    expect(isZero(summary.interest)).toBe(true)
    expect(summary.interestRatio).toBe(0)
    expect(summary.firstPeriod).toBeNull()
    expect(summary.payoffPeriod).toBeNull()
  })

  it('reconciles with the schedule for any loan', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 360 }),
        fc.double({ min: 0, max: 0.12, noNaN: true, noDefaultInfinity: true }),
        (principalMajor, termMonths, annualRate) => {
          const rows = replay({
            loan: fixedRateLoan({
              principal: fromMajorUnits(principalMajor),
              termMonths,
              annualRate,
            }),
            referenceRateAt: noRates,
          })
          const summary = totals(rows)
          expect(summary.principal).toBe(fromMajorUnits(principalMajor))
          expect(summary.totalPaid).toBe(add(summary.principal, summary.interest))
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('byYear', () => {
  const years = byYear(baseline)

  it('covers every calendar year the loan touches, in order', () => {
    expect(years[0]!.year).toBe(2021)
    expect(years.at(-1)!.year).toBe(2046)
    for (let index = 1; index < years.length; index += 1) {
      expect(years[index]!.year).toBe(years[index - 1]!.year + 1)
    }
  })

  it('sums back to the whole-schedule totals', () => {
    const summary = totals(baseline)
    expect(sum(years.map((year) => year.interest))).toBe(summary.interest)
    expect(sum(years.map((year) => year.totalPaid))).toBe(summary.totalPaid)
  })

  it('reports the December balance as the year closing balance', () => {
    const december2022 = baseline.find((row) => row.period === yearMonth(2022, 12))!
    expect(byYear(baseline).find((year) => year.year === 2022)!.closingBalance).toBe(
      december2022.closingBalance,
    )
  })

  it('shows interest falling and capital rising year on year', () => {
    // 2022 is the first full calendar year; 2045 the last.
    const first = years.find((year) => year.year === 2022)!
    const last = years.find((year) => year.year === 2045)!
    expect(last.interest < first.interest).toBe(true)
    expect(last.capital > first.capital).toBe(true)
  })

  it('returns nothing for an empty schedule', () => {
    expect(byYear([])).toEqual([])
  })
})

describe('progressToDate', () => {
  it('splits the schedule at the given period, inclusive', () => {
    const progress = progressToDate(baseline, yearMonth(2026, 8))

    // March 2021 through August 2026 inclusive is 66 instalments.
    expect(progress.periodsElapsed).toBe(66)
    expect(progress.periodsRemaining).toBe(301 - 66)
    expect(progress.remainingBalance).toBe(
      baseline.find((row) => row.period === yearMonth(2026, 8))!.closingBalance,
    )
  })

  it('accounts for the whole loan across the split', () => {
    const progress = progressToDate(baseline, yearMonth(2026, 8))
    const summary = totals(baseline)
    expect(add(progress.interestToDate, progress.remainingInterest)).toBe(summary.interest)
    expect(progress.capitalRepaidRatio).toBeGreaterThan(0)
    expect(progress.capitalRepaidRatio).toBeLessThan(1)
  })

  it('reads as untouched before the first instalment', () => {
    const progress = progressToDate(baseline, yearMonth(2020, 1))
    expect(progress.periodsElapsed).toBe(0)
    expect(progress.remainingBalance).toBe(loan.principal)
    expect(progress.capitalRepaidRatio).toBe(0)
    expect(isZero(progress.paidToDate)).toBe(true)
  })

  it('reads as complete after the final instalment', () => {
    const progress = progressToDate(baseline, yearMonth(2099, 1))
    expect(progress.periodsRemaining).toBe(0)
    expect(isZero(progress.remainingBalance)).toBe(true)
    expect(isZero(progress.remainingInterest)).toBe(true)
    expect(progress.capitalRepaidRatio).toBeCloseTo(1, 10)
  })

  it('handles an empty schedule', () => {
    const progress = progressToDate([], yearMonth(2026, 8))
    expect(progress.periodsElapsed).toBe(0)
    expect(progress.capitalRepaidRatio).toBe(0)
  })
})

describe('compareToBaseline', () => {
  const comparison = compareToBaseline(baseline, shortened)

  it('quantifies what €200 a month buys', () => {
    expect(comparison.interestSaved > ZERO).toBe(true)
    expect(comparison.monthsSaved).toBeGreaterThan(0)
    expect(comparison.scenarioPayoffPeriod! < comparison.baselinePayoffPeriod!).toBe(true)
    expect(comparison.extraPaid > ZERO).toBe(true)
  })

  it('reports total outlay saved, not just interest', () => {
    // Paying more per month still costs less overall, because the interest avoided
    // exceeds the extra principal brought forward.
    expect(comparison.totalSaved > ZERO).toBe(true)
  })

  it('expresses interest avoided per euro overpaid', () => {
    // Well under 1, and that is not a disappointing result: the overpayment retires
    // principal that was owed anyway, so only the interest it avoids is a saving.
    expect(comparison.interestSavedPerUnitOverpaid).toBeGreaterThan(0)
    expect(comparison.interestSavedPerUnitOverpaid).toBeLessThan(1)
  })

  it('reports no saving when comparing a schedule with itself', () => {
    const identical = compareToBaseline(baseline, baseline)
    expect(isZero(identical.interestSaved)).toBe(true)
    expect(identical.monthsSaved).toBe(0)
    expect(identical.interestSavedPerUnitOverpaid).toBe(0)
  })

  it('shows lowering the payment saving less than shortening the term', () => {
    const lowered = replay({
      loan,
      referenceRateAt: noRates,
      events: [{ ...extra200[0]!, effect: 'LOWER_PAYMENT' } as LoanEvent],
    })
    const loweredComparison = compareToBaseline(baseline, lowered)

    expect(loweredComparison.interestSaved < comparison.interestSaved).toBe(true)
    expect(loweredComparison.monthsSaved).toBeLessThanOrEqual(comparison.monthsSaved)
  })
})

describe('breakEven', () => {
  it('finds the month cumulative outlay equalises', () => {
    const point = breakEven(baseline, shortened)

    expect(point).not.toBeNull()
    expect(point!.cumulativeScenarioPaid <= point!.cumulativeBaselinePaid).toBe(true)
    // Falls after the overpaying schedule has been settled: only once the baseline is
    // still paying and the scenario is not does the cumulative spend catch up.
    expect(point!.period > shortened.at(-1)!.period).toBe(true)
    expect(point!.monthsFromStart).toBeGreaterThan(shortened.length)
  })

  it('reports how far out of pocket the overpayer got before that', () => {
    const point = breakEven(baseline, shortened)!
    // €200 a month for the ~18 years the scenario runs.
    expect(point.peakAdditionalOutlay > fromMajorUnits(30_000)).toBe(true)
    expect(point.peakAdditionalOutlay).toBe(totals(shortened).extraPayments)
  })

  it('returns null when the scenario is never out of pocket', () => {
    expect(breakEven(baseline, baseline)).toBeNull()
  })

  it('returns null for empty schedules', () => {
    expect(breakEven([], [])).toBeNull()
  })
})

describe('runningTotals', () => {
  const running = runningTotals(baseline)

  it('ends at the whole-schedule totals', () => {
    const summary = totals(baseline)
    expect(running.at(-1)!.cumulativeInterest).toBe(summary.interest)
    expect(running.at(-1)!.cumulativePaid).toBe(summary.totalPaid)
    expect(running.at(-1)!.cumulativeCapital).toBe(loan.principal)
    expect(isZero(running.at(-1)!.balance)).toBe(true)
  })

  it('increases monotonically', () => {
    for (let index = 1; index < running.length; index += 1) {
      expect(running[index]!.cumulativeInterest >= running[index - 1]!.cumulativeInterest).toBe(
        true,
      )
      expect(running[index]!.cumulativeCapital >= running[index - 1]!.cumulativeCapital).toBe(true)
      expect(running[index]!.balance <= running[index - 1]!.balance).toBe(true)
    }
  })

  it('returns nothing for an empty schedule', () => {
    expect(runningTotals([])).toEqual([])
  })
})

describe('crossoverPeriod', () => {
  it('finds the month capital first exceeds interest', () => {
    // Month 57 of 300 — the same crossover the schedule tests pin down.
    expect(crossoverPeriod(baseline)).toBe(yearMonth(2025, 11))
  })

  it('is the first period for a zero-interest loan', () => {
    const rows = replay({
      loan: fixedRateLoan({ annualRate: 0, termMonths: 12 }),
      referenceRateAt: noRates,
    })
    expect(crossoverPeriod(rows)).toBe(yearMonth(2021, 3))
  })

  it('returns null when there is no schedule', () => {
    expect(crossoverPeriod([])).toBeNull()
  })
})
