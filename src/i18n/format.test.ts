import { describe, expect, it } from 'vitest'

import { localDate, yearMonth } from '@/domain/dates'
import { fromMajorUnits, money, ZERO } from '@/domain/money'
import {
  formatBasisPoints,
  formatDate,
  formatDateIso,
  formatInteger,
  formatMoney,
  formatMoneyCompact,
  formatPercentChange,
  formatPeriod,
  formatRate,
  resolveLocale,
  splitMonths,
  toDecimalString,
} from '@/i18n/format'

/** Non-breaking and narrow-no-break spaces appear in several locales' output. */
const normaliseSpaces = (value: string) => value.replaceAll(/[  ]/g, ' ')

describe('toDecimalString', () => {
  it('converts minor units to an exact decimal string', () => {
    expect(toDecimalString(money(81_244n))).toBe('812.44')
    expect(toDecimalString(money(25_000_000n))).toBe('250000.00')
    expect(toDecimalString(money(1n))).toBe('0.01')
    expect(toDecimalString(money(10n))).toBe('0.10')
    expect(toDecimalString(ZERO)).toBe('0.00')
  })

  it('handles negatives', () => {
    expect(toDecimalString(money(-1n))).toBe('-0.01')
    expect(toDecimalString(money(-81_244n))).toBe('-812.44')
  })

  it('stays exact at magnitudes no float could represent', () => {
    // The point of the string bridge. 12345678901234567899 cents is beyond 2^53, so
    // Number(cents) / 100 would have silently lost the trailing digits.
    const cents = 12_345_678_901_234_567_899n
    expect(toDecimalString(money(cents))).toBe('123456789012345678.99')
    // The route this replaces: converting to a Number first has already lost the cents.
    expect(String(Number(cents) / 100)).not.toBe('123456789012345678.99')
  })
})

describe('formatMoney', () => {
  it('formats with the currency symbol', () => {
    expect(normaliseSpaces(formatMoney(fromMajorUnits(1234.56), 'EUR', 'en-US'))).toBe('€1,234.56')
  })

  it('follows the locale, not English conventions', () => {
    // A Finnish user writes 1 234,56 €. Nothing in the app should have to think about it.
    expect(normaliseSpaces(formatMoney(fromMajorUnits(1234.56), 'EUR', 'fi-FI'))).toBe('1 234,56 €')
    expect(normaliseSpaces(formatMoney(fromMajorUnits(1234.56), 'EUR', 'de-DE'))).toBe('1.234,56 €')
  })

  it('never loses a cent to float rounding', () => {
    // 0.1 + 0.2 territory: these are exact because the value never becomes a Number.
    expect(normaliseSpaces(formatMoney(money(1_00_5n), 'EUR', 'en-US'))).toBe('€10.05')
    expect(normaliseSpaces(formatMoney(money(70_833n), 'EUR', 'en-US'))).toBe('€708.33')
  })

  it('can omit the symbol for dense tables', () => {
    expect(
      normaliseSpaces(
        formatMoney(fromMajorUnits(1234.56), 'EUR', 'en-US', { withoutSymbol: true }),
      ),
    ).toBe('1,234.56')
  })

  it('can drop the cents for headline figures', () => {
    expect(
      normaliseSpaces(formatMoney(fromMajorUnits(1234.56), 'EUR', 'en-US', { whole: true })),
    ).toBe('€1,235')
  })

  it('can show a sign, for savings and differences', () => {
    expect(
      normaliseSpaces(formatMoney(fromMajorUnits(200), 'EUR', 'en-US', { signed: true })),
    ).toBe('+€200.00')
    expect(
      normaliseSpaces(formatMoney(fromMajorUnits(-200), 'EUR', 'en-US', { signed: true })),
    ).toBe('-€200.00')
    expect(normaliseSpaces(formatMoney(ZERO, 'EUR', 'en-US', { signed: true }))).toBe('€0.00')
  })

  it('formats a currency other than the euro', () => {
    expect(normaliseSpaces(formatMoney(fromMajorUnits(1234.56), 'SEK', 'sv-SE'))).toContain('kr')
  })
})

describe('formatMoneyCompact', () => {
  it('shortens amounts for chart axes', () => {
    expect(normaliseSpaces(formatMoneyCompact(fromMajorUnits(250_000), 'EUR', 'en-US'))).toBe(
      '€250K',
    )
    expect(normaliseSpaces(formatMoneyCompact(fromMajorUnits(1_200_000), 'EUR', 'en-US'))).toBe(
      '€1.2M',
    )
  })
})

describe('formatRate', () => {
  it('shows three decimal places by default, which is what lenders quote', () => {
    expect(normaliseSpaces(formatRate(0.028_550_87, 'en-US'))).toBe('2.855%')
    expect(normaliseSpaces(formatRate(0.034, 'en-US'))).toBe('3.400%')
  })

  it('follows the locale', () => {
    expect(normaliseSpaces(formatRate(0.028_55, 'fi-FI'))).toBe('2,855 %')
  })

  it('handles a negative rate, as EURIBOR was for years', () => {
    expect(normaliseSpaces(formatRate(-0.005_047, 'en-US'))).toBe('-0.505%')
  })

  it('accepts a different precision', () => {
    expect(normaliseSpaces(formatRate(0.028_55, 'en-US', 1))).toBe('2.9%')
  })
})

describe('other number formats', () => {
  it('formats basis points with a sign', () => {
    expect(formatBasisPoints(55, 'en-US')).toBe('+55')
    expect(formatBasisPoints(-100, 'en-US')).toBe('-100')
    expect(formatBasisPoints(0, 'en-US')).toBe('0')
  })

  it('formats a percentage change with a sign', () => {
    expect(normaliseSpaces(formatPercentChange(0.4858, 'en-US'))).toBe('+48.6%')
    expect(normaliseSpaces(formatPercentChange(-0.1, 'en-US'))).toBe('-10.0%')
  })

  it('formats whole numbers with locale separators', () => {
    expect(normaliseSpaces(formatInteger(1234, 'en-US'))).toBe('1,234')
    expect(normaliseSpaces(formatInteger(1234, 'fi-FI'))).toBe('1 234')
  })
})

describe('formatPeriod', () => {
  it('renders a month and year', () => {
    expect(formatPeriod(yearMonth(2026, 8), 'en-US')).toBe('August 2026')
    expect(formatPeriod(yearMonth(2026, 8), 'en-US', 'short')).toBe('Aug 2026')
    expect(formatPeriod(yearMonth(2026, 8), 'en-US', 'numeric')).toBe('08/2026')
  })

  it('follows the locale', () => {
    expect(formatPeriod(yearMonth(2026, 8), 'fi-FI')).toContain('2026')
    expect(formatPeriod(yearMonth(2026, 1), 'de-DE')).toContain('Januar')
  })

  it('never drifts into the wrong month, in any time zone', () => {
    // A civil month has no instant. Formatting via local midnight would render December in
    // time zones behind UTC; day 1 at midnight UTC with timeZone: 'UTC' cannot.
    for (let month = 1; month <= 12; month += 1) {
      expect(formatPeriod(yearMonth(2026, month), 'en-US', 'numeric')).toBe(
        `${String(month).padStart(2, '0')}/2026`,
      )
    }
  })
})

describe('formatDate', () => {
  it('renders a civil date', () => {
    expect(formatDate(localDate(2026, 8, 14), 'en-US', 'short')).toBe('8/14/26')
    expect(formatDate(localDate(2026, 8, 14), 'en-GB', 'short')).toBe('14/08/2026')
  })

  it('never shifts the day, in any time zone', () => {
    // The bug this prevents: a payment due on the 1st showing as the last day of the
    // previous month for users west of UTC.
    expect(formatDate(localDate(2026, 1, 1), 'en-CA', 'short')).toBe('2026-01-01')
    expect(formatDate(localDate(2026, 12, 31), 'en-CA', 'short')).toBe('2026-12-31')
  })

  it('gives an ISO form for filenames and datetime attributes', () => {
    expect(formatDateIso(localDate(2026, 8, 4))).toBe('2026-08-04')
  })
})

describe('splitMonths', () => {
  it('splits a duration into years and months', () => {
    expect(splitMonths(40)).toEqual({ years: 3, months: 4 })
    expect(splitMonths(12)).toEqual({ years: 1, months: 0 })
    expect(splitMonths(11)).toEqual({ years: 0, months: 11 })
    expect(splitMonths(0)).toEqual({ years: 0, months: 0 })
  })

  it('keeps the sign on both parts', () => {
    expect(splitMonths(-14)).toEqual({ years: -1, months: -2 })
  })

  it('returns parts rather than a string, leaving plurals to the translator', () => {
    // "1 year 1 month" versus "2 years 3 months" cannot be assembled from English rules
    // and applied to every language.
    const { years, months } = splitMonths(13)
    expect(typeof years).toBe('number')
    expect(typeof months).toBe('number')
  })
})

describe('resolveLocale', () => {
  it('prefers an explicit choice', () => {
    expect(resolveLocale('fi-FI')).toBe('fi-FI')
  })

  it('detects the environment locale when nothing is stored', () => {
    // Both `null` and `''` mean "not chosen", and both fall through to detection. The
    // result depends on the host, so this only asserts it produced a usable tag.
    for (const stored of [null, '']) {
      const resolved = resolveLocale(stored, 'en')
      expect(resolved).toMatch(/^[a-z]{2}(-[A-Za-z0-9]+)*$/)
      expect(() => new Intl.NumberFormat(resolved)).not.toThrow()
    }
  })
})
