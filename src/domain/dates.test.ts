import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  addMonths,
  addMonthsToDate,
  compareDates,
  compareYearMonth,
  DAY_COUNT_CONVENTIONS,
  daysBetween,
  daysInMonth,
  formatLocalDate,
  isLeapYear,
  localDate,
  monthsBetween,
  parseLocalDate,
  parseYearMonth,
  paymentDateFor,
  toEpochDay,
  yearFraction,
  yearMonth,
  yearMonthOf,
} from '@/domain/dates'

describe('localDate', () => {
  it('rejects dates that do not exist', () => {
    expect(() => localDate(2026, 2, 30)).toThrow(RangeError)
    expect(() => localDate(2026, 13, 1)).toThrow(RangeError)
    expect(() => localDate(2026, 0, 1)).toThrow(RangeError)
    expect(() => localDate(2026, 1, 0)).toThrow(RangeError)
  })

  it('accepts 29 February only in leap years', () => {
    expect(() => localDate(2024, 2, 29)).not.toThrow()
    expect(() => localDate(2026, 2, 29)).toThrow(RangeError)
  })

  it('parses and formats ISO dates', () => {
    expect(parseLocalDate('2026-08-14')).toEqual({ year: 2026, month: 8, day: 14 })
    expect(formatLocalDate(localDate(2026, 8, 4))).toBe('2026-08-04')
    expect(parseLocalDate('2026-8-4')).toBeNull()
    expect(parseLocalDate('not a date')).toBeNull()
    expect(parseLocalDate('2026-02-30')).toBeNull()
  })
})

describe('leap years and month lengths', () => {
  it('follows the Gregorian rule at century boundaries', () => {
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2026)).toBe(false)
  })

  it('knows how long each month is', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
  })
})

describe('toEpochDay', () => {
  it('anchors on the Unix epoch', () => {
    expect(toEpochDay(localDate(1970, 1, 1))).toBe(0)
    expect(toEpochDay(localDate(1970, 1, 2))).toBe(1)
    expect(toEpochDay(localDate(1969, 12, 31))).toBe(-1)
  })

  it('agrees with the platform Date implementation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (year, month, day) => {
          const expected = Math.round(Date.UTC(year, month - 1, day) / 86_400_000)
          expect(toEpochDay(localDate(year, month, day))).toBe(expected)
        },
      ),
    )
  })

  it('counts actual days between dates, including across leap days', () => {
    expect(daysBetween(localDate(2024, 2, 28), localDate(2024, 3, 1))).toBe(2)
    expect(daysBetween(localDate(2026, 2, 28), localDate(2026, 3, 1))).toBe(1)
    expect(daysBetween(localDate(2026, 1, 1), localDate(2027, 1, 1))).toBe(365)
  })
})

describe('addMonthsToDate', () => {
  it('clamps to the end of a shorter month rather than overflowing', () => {
    // The bug this prevents: 31 Jan + 1 month must not become 3 March.
    expect(addMonthsToDate(localDate(2026, 1, 31), 1)).toEqual({ year: 2026, month: 2, day: 28 })
    expect(addMonthsToDate(localDate(2024, 1, 31), 1)).toEqual({ year: 2024, month: 2, day: 29 })
    expect(addMonthsToDate(localDate(2026, 3, 31), 1)).toEqual({ year: 2026, month: 4, day: 30 })
  })

  it('rolls across year boundaries in both directions', () => {
    expect(addMonthsToDate(localDate(2026, 11, 15), 3)).toEqual({ year: 2027, month: 2, day: 15 })
    expect(addMonthsToDate(localDate(2026, 2, 15), -3)).toEqual({ year: 2025, month: 11, day: 15 })
  })

  it('is the identity for zero months', () => {
    const date = localDate(2026, 8, 14)
    expect(addMonthsToDate(date, 0)).toEqual(date)
  })
})

describe('year-month periods', () => {
  it('formats and parses', () => {
    expect(yearMonth(2026, 8)).toBe('2026-08')
    expect(parseYearMonth('2026-08')).toBe('2026-08')
    expect(parseYearMonth('2026-13')).toBeNull()
    expect(parseYearMonth('2026-8')).toBeNull()
    expect(yearMonthOf(localDate(2026, 8, 14))).toBe('2026-08')
  })

  it('adds months across year boundaries', () => {
    expect(addMonths(yearMonth(2026, 11), 3)).toBe('2027-02')
    expect(addMonths(yearMonth(2026, 1), -1)).toBe('2025-12')
    expect(addMonths(yearMonth(2026, 8), 0)).toBe('2026-08')
  })

  it('counts months between periods, signed', () => {
    expect(monthsBetween(yearMonth(2026, 1), yearMonth(2026, 12))).toBe(11)
    expect(monthsBetween(yearMonth(2026, 12), yearMonth(2026, 1))).toBe(-11)
    expect(monthsBetween(yearMonth(2021, 3), yearMonth(2041, 3))).toBe(240)
  })

  it('round-trips through addMonths and monthsBetween', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2090 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -600, max: 600 }),
        (year, month, offset) => {
          const start = yearMonth(year, month)
          expect(monthsBetween(start, addMonths(start, offset))).toBe(offset)
        },
      ),
    )
  })

  it('sorts lexicographically, which is the same as chronologically', () => {
    // Zero-padding is what makes this true; it is why the type is a padded string.
    expect(compareYearMonth(yearMonth(2026, 9), yearMonth(2026, 10))).toBeLessThan(0)
    expect([yearMonth(2026, 10), yearMonth(2026, 9)].toSorted()).toEqual(['2026-09', '2026-10'])
  })
})

describe('paymentDateFor', () => {
  it('clamps a late payment day to the last day of a short month', () => {
    // A loan with a 31st payment day still pays in February.
    expect(paymentDateFor(yearMonth(2026, 2), 31)).toEqual({ year: 2026, month: 2, day: 28 })
    expect(paymentDateFor(yearMonth(2024, 2), 31)).toEqual({ year: 2024, month: 2, day: 29 })
    expect(paymentDateFor(yearMonth(2026, 4), 31)).toEqual({ year: 2026, month: 4, day: 30 })
  })

  it('uses the requested day when the month is long enough', () => {
    expect(paymentDateFor(yearMonth(2026, 8), 15)).toEqual({ year: 2026, month: 8, day: 15 })
  })

  it('rejects an impossible payment day', () => {
    expect(() => paymentDateFor(yearMonth(2026, 8), 0)).toThrow(RangeError)
    expect(() => paymentDateFor(yearMonth(2026, 8), 32)).toThrow(RangeError)
  })
})

describe('yearFraction', () => {
  const jan31 = localDate(2026, 1, 31)
  const feb28 = localDate(2026, 2, 28)
  const mar31 = localDate(2026, 3, 31)

  it('MONTHLY_NOMINAL treats every month as exactly one twelfth', () => {
    // This is the textbook annuity assumption and what most online calculators use.
    expect(yearFraction(jan31, feb28, 'MONTHLY_NOMINAL')).toBeCloseTo(1 / 12, 12)
    expect(yearFraction(feb28, mar31, 'MONTHLY_NOMINAL')).toBeCloseTo(1 / 12, 12)
    expect(yearFraction(jan31, mar31, 'MONTHLY_NOMINAL')).toBeCloseTo(2 / 12, 12)
  })

  it('MONTHLY_NOMINAL counts a clamped payment date as a whole month', () => {
    // Regression: a loan paying on the 31st has its February payment clamped to the
    // 28th, so consecutive payment dates run 31 -> 28. Comparing day numbers alone
    // scored that as zero months and silently dropped a month of interest.
    const schedule = [
      paymentDateFor(yearMonth(2026, 1), 31),
      paymentDateFor(yearMonth(2026, 2), 31),
      paymentDateFor(yearMonth(2026, 3), 31),
    ]
    for (let index = 1; index < schedule.length; index += 1) {
      expect(yearFraction(schedule[index - 1]!, schedule[index]!, 'MONTHLY_NOMINAL')).toBeCloseTo(
        1 / 12,
        12,
      )
    }
  })

  it('MONTHLY_NOMINAL still reports a genuinely partial month as zero', () => {
    expect(yearFraction(localDate(2026, 1, 15), localDate(2026, 2, 10), 'MONTHLY_NOMINAL')).toBe(0)
    expect(yearFraction(localDate(2026, 1, 1), localDate(2026, 1, 31), 'MONTHLY_NOMINAL')).toBe(0)
  })

  it('ACT_360 uses real elapsed days over a 360-day year', () => {
    // 28 actual days in this period; the >1/12 result is why a bank using ACT/360
    // charges slightly more interest per year than the nominal rate suggests.
    expect(yearFraction(jan31, feb28, 'ACT_360')).toBeCloseTo(28 / 360, 12)
    expect(yearFraction(localDate(2026, 1, 1), localDate(2027, 1, 1), 'ACT_360')).toBeCloseTo(
      365 / 360,
      12,
    )
  })

  it('ACT_365 uses real elapsed days over a 365-day year', () => {
    expect(yearFraction(jan31, feb28, 'ACT_365')).toBeCloseTo(28 / 365, 12)
    expect(yearFraction(localDate(2026, 1, 1), localDate(2027, 1, 1), 'ACT_365')).toBe(1)
  })

  it('THIRTY_360_EU caps both day-of-month values at 30', () => {
    // 31 Jan -> 28 Feb becomes 30 -> 28, i.e. 28 days.
    expect(yearFraction(jan31, feb28, 'THIRTY_360_EU')).toBeCloseTo(28 / 360, 12)
    // 31 Jan -> 31 Mar becomes 30 -> 30, i.e. exactly two 30-day months.
    expect(yearFraction(jan31, mar31, 'THIRTY_360_EU')).toBeCloseTo(60 / 360, 12)
  })

  it('THIRTY_360_US only pulls the end date back when the start was already at 30', () => {
    expect(yearFraction(jan31, mar31, 'THIRTY_360_US')).toBeCloseTo(60 / 360, 12)
    // Start on the 15th: the end date stays at 31, giving 46 days rather than 45.
    expect(yearFraction(localDate(2026, 1, 15), mar31, 'THIRTY_360_US')).toBeCloseTo(76 / 360, 12)
  })

  it('is zero for a zero-length period under every convention', () => {
    for (const convention of DAY_COUNT_CONVENTIONS) {
      expect(yearFraction(jan31, jan31, convention)).toBe(0)
    }
  })

  it('is additive across a split point for the actual/* conventions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        (firstSpan, secondSpan) => {
          const start = localDate(2020, 1, 1)
          const a = addDays(start, firstSpan)
          const b = addDays(a, secondSpan)
          for (const convention of ['ACT_360', 'ACT_365'] as const) {
            expect(yearFraction(start, b, convention)).toBeCloseTo(
              yearFraction(start, a, convention) + yearFraction(a, b, convention),
              10,
            )
          }
        },
      ),
    )
  })

  it('never returns a negative fraction for an ordered period', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4000 }), (span) => {
        const start = localDate(2020, 1, 1)
        const end = addDays(start, span)
        expect(compareDates(start, end)).toBeLessThanOrEqual(0)
        for (const convention of DAY_COUNT_CONVENTIONS) {
          expect(yearFraction(start, end, convention)).toBeGreaterThanOrEqual(0)
        }
      }),
    )
  })
})

/** Test helper: shifts a date by whole days via the epoch-day round trip. */
function addDays(date: ReturnType<typeof localDate>, days: number) {
  const epoch = toEpochDay(date) + days
  const asDate = new Date(epoch * 86_400_000)
  return localDate(asDate.getUTCFullYear(), asDate.getUTCMonth() + 1, asDate.getUTCDate())
}
