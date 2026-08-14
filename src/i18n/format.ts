import type { LocalDate, YearMonth } from '@/domain/dates'
import type { Money } from '@/domain/money'

import { formatLocalDate, monthOf, yearOf } from '@/domain/dates'
import { toCents } from '@/domain/money'

/**
 * Locale-aware formatting.
 *
 * Everything goes through `Intl`. No hand-rolled thousands separators, no hardcoded `€`,
 * no assumption that a decimal point is a point — a Finnish user writes `1 234,56 €` and
 * the app has to render that without anyone thinking about it.
 *
 * Money never touches a float on the way to the screen. `Intl.NumberFormat.format()`
 * accepts a decimal *string* and formats it exactly, so `bigint` minor units are turned
 * into an exact decimal string and handed straight over. Routing through `Number` would
 * reintroduce, at the last step, precisely the imprecision the engine works to avoid.
 */

const MINOR_UNIT_DECIMALS = 2

/**
 * `Intl.NumberFormat.prototype.format` accepts a decimal *string* at runtime and formats
 * it exactly, which is what lets money reach the screen without ever becoming a float.
 * TypeScript's lib types still declare only `number | bigint`, so the gap is acknowledged
 * here, once, rather than with a cast at every call site.
 */
interface ExactNumberFormat {
  format(value: string): string
}

function formatExact(formatter: Intl.NumberFormat, decimal: string): string {
  return (formatter as unknown as ExactNumberFormat).format(decimal)
}

/** Formatters are expensive to construct and are reused constantly. */
const numberFormatCache = new Map<string, Intl.NumberFormat>()
const dateFormatCache = new Map<string, Intl.DateTimeFormat>()

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = numberFormatCache.get(key)
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, options)
    numberFormatCache.set(key, formatter)
  }
  return formatter
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = dateFormatCache.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, options)
    dateFormatCache.set(key, formatter)
  }
  return formatter
}

/**
 * Exact decimal string for a monetary amount: `81244n` becomes `"812.44"`.
 *
 * The bridge between exact `bigint` arithmetic and `Intl`. Built by string manipulation
 * rather than division so nothing is lost, at any magnitude.
 */
export function toDecimalString(amount: Money): string {
  const cents = toCents(amount)
  const negative = cents < 0n
  const digits = (negative ? -cents : cents).toString().padStart(MINOR_UNIT_DECIMALS + 1, '0')
  const whole = digits.slice(0, -MINOR_UNIT_DECIMALS)
  const fraction = digits.slice(-MINOR_UNIT_DECIMALS)
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export interface MoneyFormatOptions {
  /** Hide the currency symbol, for dense tables where the column header carries it. */
  readonly withoutSymbol?: boolean
  /** Drop the cents. Useful in chart axis labels and headline figures. */
  readonly whole?: boolean
  /** Show `+` on positive amounts, for savings and differences. */
  readonly signed?: boolean
}

export function formatMoney(
  amount: Money,
  currency: string,
  locale: string,
  options: MoneyFormatOptions = {},
): string {
  const decimals = options.whole === true ? 0 : MINOR_UNIT_DECIMALS

  return formatExact(
    numberFormat(locale, {
      ...(options.withoutSymbol === true
        ? { style: 'decimal' }
        : { style: 'currency', currency, currencyDisplay: 'symbol' }),
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      ...(options.signed === true ? { signDisplay: 'exceptZero' } : {}),
    }),
    toDecimalString(amount),
  )
}

/**
 * Compact money for chart axes: `€250k`, `€1.2M`.
 *
 * Takes the precision loss deliberately — an axis tick has no room for cents and no need
 * for them. Never use this where a figure will be read as authoritative.
 */
export function formatMoneyCompact(amount: Money, currency: string, locale: string): string {
  return numberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(toDecimalString(amount)))
}

/**
 * Compact money from a plain number of major units, for chart axis ticks.
 *
 * Takes a `number` rather than `Money` because an axis tick is generated *from the
 * plotted geometry*, which is already a float — asking the caller to rebuild an exact
 * amount just to round it away would be ceremony. Never use this for a figure a reader
 * will treat as authoritative.
 */
export function formatAxisMoney(majorUnits: number, currency: string, locale: string): string {
  return numberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(majorUnits)
}

/**
 * A rate as a percentage. `0.028550_87` becomes `2.855 %` (spacing per locale).
 *
 * Three decimal places by default, because that is the precision lenders quote and
 * borrowers compare — rounding a rate to two decimals hides a real difference in cost.
 */
export function formatRate(rate: number, locale: string, decimals = 3): string {
  return numberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rate)
}

/** Basis points, for margins: `55` becomes `+55 bp`. Unit label comes from i18n. */
export function formatBasisPoints(basisPoints: number, locale: string): string {
  return numberFormat(locale, { signDisplay: 'exceptZero', maximumFractionDigits: 0 }).format(
    basisPoints,
  )
}

export function formatPercentChange(ratio: number, locale: string, decimals = 1): string {
  return numberFormat(locale, {
    style: 'percent',
    signDisplay: 'exceptZero',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio)
}

export function formatInteger(value: number, locale: string): string {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

/**
 * A `YearMonth` as a month and year: `2026-08` becomes `August 2026`.
 *
 * `Date.UTC` is used purely to hand `Intl` something it accepts; the value is a civil
 * month with no instant attached, and day 1 at midnight UTC cannot shift the month in any
 * time zone the way a local-midnight `Date` could.
 */
export function formatPeriod(
  period: YearMonth,
  locale: string,
  style: 'long' | 'short' | 'numeric' = 'long',
): string {
  const instant = new Date(Date.UTC(yearOf(period), monthOf(period) - 1, 1))

  return dateFormat(locale, {
    year: 'numeric',
    month: style === 'numeric' ? '2-digit' : style,
    timeZone: 'UTC',
  }).format(instant)
}

export function formatDate(
  date: LocalDate,
  locale: string,
  style: 'long' | 'medium' | 'short' = 'medium',
): string {
  const instant = new Date(Date.UTC(date.year, date.month - 1, date.day))
  return dateFormat(locale, { dateStyle: style, timeZone: 'UTC' }).format(instant)
}

/** ISO 8601, locale-independent. For filenames, `datetime` attributes and debugging. */
export function formatDateIso(date: LocalDate): string {
  return formatLocalDate(date)
}

/**
 * A duration in months, as years and months.
 *
 * Returns the parts rather than a string: pluralisation is the translation layer's job,
 * and "1 year 1 month" versus "2 years 3 months" is exactly the kind of thing that cannot
 * be assembled correctly from English rules alone.
 */
export function splitMonths(totalMonths: number): { years: number; months: number } {
  const magnitude = Math.abs(totalMonths)
  const sign = totalMonths < 0 ? -1 : 1
  return {
    years: sign * Math.floor(magnitude / 12),
    months: sign * (magnitude % 12),
  }
}

/** Resolves a stored preference to a concrete BCP 47 tag. */
export function resolveLocale(preferred: string | null, fallback = 'en'): string {
  if (preferred !== null && preferred.length > 0) return preferred
  const detected = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language
  return detected ?? fallback
}

/** Clears the formatter caches. Only needed by tests that change locale. */
export function clearFormatterCaches(): void {
  numberFormatCache.clear()
  dateFormatCache.clear()
}
