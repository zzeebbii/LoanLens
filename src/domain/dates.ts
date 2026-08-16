/**
 * Calendar arithmetic and interest day-count conventions.
 *
 * Deliberately does not use `Date`. `Date` is a timestamp with a time zone, and a
 * payment due on the 1st of the month is neither — treating it as one is how loan
 * schedules acquire off-by-one-day errors for users east or west of UTC. These are
 * plain civil dates with no instant attached.
 */

/** A civil date with no time and no zone. */
export interface LocalDate {
  readonly year: number
  readonly month: number // 1-12
  readonly day: number // 1-31
}

declare const yearMonthBrand: unique symbol

/**
 * A calendar month, formatted `YYYY-MM`.
 *
 * Held as a zero-padded string so it works directly as a `Map` key and so
 * lexicographic order is chronological order — which means periods sort correctly
 * with no comparator at all.
 */
export type YearMonth = string & { readonly [yearMonthBrand]: true }

export const MONTHS_PER_YEAR = 12

/**
 * How a period's interest is converted from an annual rate.
 *
 * This is not a detail: over 25 years the choice moves the total interest by
 * thousands, and lenders genuinely differ. It is per-loan configuration, and the
 * right value is whatever the user's own loan agreement says.
 *
 * - `MONTHLY_NOMINAL` — every month is exactly 1/12 of a year. The textbook annuity
 *   assumption, and what most online calculators use. The default here, because it is
 *   what a user comparing against a public calculator will expect.
 * - `ACT_360` — actual elapsed days over a 360-day year. Common in Nordic and
 *   continental European lending. Charges ~1.4% more interest per year than nominal,
 *   because 365 real days are divided by 360.
 * - `ACT_365` — actual elapsed days over a 365-day year.
 * - `THIRTY_360_EU` — 30E/360 ("Eurobond basis"): both day-of-month values capped at 30.
 * - `THIRTY_360_US` — 30/360 bond basis: the end date is pulled back to 30 only when
 *   the start date was already at 30 or 31.
 */
export const DAY_COUNT_CONVENTIONS = [
  'MONTHLY_NOMINAL',
  'ACT_360',
  'ACT_365',
  'THIRTY_360_EU',
  'THIRTY_360_US',
] as const

export type DayCountConvention = (typeof DAY_COUNT_CONVENTIONS)[number]

export const DEFAULT_DAY_COUNT: DayCountConvention = 'MONTHLY_NOMINAL'

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export function daysInMonth(year: number, month: number): number {
  // The lookup doubles as the range check: an out-of-range or fractional month simply
  // misses the table, which keeps validation and indexing from drifting apart.
  const length = Number.isInteger(month) ? MONTH_LENGTHS[month - 1] : undefined
  if (length === undefined) {
    throw new RangeError(`Month must be 1-12, received ${month}.`)
  }
  return month === 2 && isLeapYear(year) ? 29 : length
}

/** Constructs a date, rejecting anything that is not a real calendar day. */
export function localDate(year: number, month: number, day: number): LocalDate {
  if (!Number.isInteger(year)) {
    throw new RangeError(`Year must be an integer, received ${year}.`)
  }
  const length = daysInMonth(year, month)
  if (!Number.isInteger(day) || day < 1 || day > length) {
    throw new RangeError(
      `Day must be 1-${length} for ${year}-${String(month).padStart(2, '0')}, received ${day}.`,
    )
  }
  return { year, month, day }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parses `YYYY-MM-DD`. Returns `null` for anything malformed or non-existent. */
export function parseLocalDate(input: string): LocalDate | null {
  const match = ISO_DATE.exec(input.trim())
  if (!match) return null
  try {
    return localDate(Number(match[1]), Number(match[2]), Number(match[3]))
  } catch {
    return null
  }
}

export function formatLocalDate(date: LocalDate): string {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${date.year}-${month}-${day}`
}

/**
 * Days since 1970-01-01, using Howard Hinnant's `days_from_civil` algorithm.
 *
 * Written out rather than delegated to `Date` so the calculation stays independent of
 * host time zones and of `Date`'s two-digit-year quirks.
 */
export function toEpochDay(date: LocalDate): number {
  const year = date.year - (date.month <= 2 ? 1 : 0)
  const era = Math.floor(year / 400)
  const yearOfEra = year - era * 400 // [0, 399]
  const dayOfYear =
    Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146_097 + dayOfEra - 719_468
}

/** Actual calendar days from `from` to `to`. Negative if `to` precedes `from`. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from)
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return toEpochDay(a) - toEpochDay(b)
}

/**
 * Shifts by whole months, clamping the day to the target month's length.
 *
 * A loan taken out on 31 January pays on 28 February, not 3 March. Naive month
 * arithmetic overflows, which silently shifts every subsequent payment date.
 */
export function addMonthsToDate(date: LocalDate, months: number): LocalDate {
  const totalMonths = date.year * MONTHS_PER_YEAR + (date.month - 1) + months
  const year = Math.floor(totalMonths / MONTHS_PER_YEAR)
  const month = totalMonths - year * MONTHS_PER_YEAR + 1
  return localDate(year, month, Math.min(date.day, daysInMonth(year, month)))
}

export function yearMonth(year: number, month: number): YearMonth {
  if (!Number.isInteger(month) || month < 1 || month > MONTHS_PER_YEAR) {
    throw new RangeError(`Month must be 1-12, received ${month}.`)
  }
  if (!Number.isInteger(year)) {
    throw new RangeError(`Year must be an integer, received ${year}.`)
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` as YearMonth
}

const ISO_YEAR_MONTH = /^(\d{4})-(\d{2})$/

export function parseYearMonth(input: string): YearMonth | null {
  const match = ISO_YEAR_MONTH.exec(input.trim())
  if (!match) return null
  try {
    return yearMonth(Number(match[1]), Number(match[2]))
  } catch {
    return null
  }
}

export function yearMonthOf(date: LocalDate): YearMonth {
  return yearMonth(date.year, date.month)
}

export function yearOf(period: YearMonth): number {
  return Number(period.slice(0, 4))
}

export function monthOf(period: YearMonth): number {
  return Number(period.slice(5, 7))
}

/** Total months since year 0, the internal representation for period arithmetic. */
function toMonthOrdinal(period: YearMonth): number {
  return yearOf(period) * MONTHS_PER_YEAR + (monthOf(period) - 1)
}

export function addMonths(period: YearMonth, months: number): YearMonth {
  const ordinal = toMonthOrdinal(period) + months
  const year = Math.floor(ordinal / MONTHS_PER_YEAR)
  return yearMonth(year, ordinal - year * MONTHS_PER_YEAR + 1)
}

/** Signed count of months from `from` to `to`. */
export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return toMonthOrdinal(to) - toMonthOrdinal(from)
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The date a payment falls due in a given month.
 *
 * A loan whose payment day is the 31st still pays in February; the day is clamped to
 * the end of the month rather than rolling into the next one.
 */
export function paymentDateFor(period: YearMonth, paymentDay: number): LocalDate {
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) {
    throw new RangeError(`Payment day must be 1-31, received ${paymentDay}.`)
  }
  const year = yearOf(period)
  const month = monthOf(period)
  return localDate(year, month, Math.min(paymentDay, daysInMonth(year, month)))
}

/** 30/360-family day count: both conventions differ only in how they adjust the day numbers. */
function thirty360Days(from: LocalDate, to: LocalDate, variant: 'EU' | 'US'): number {
  let startDay = from.day
  let endDay = to.day

  if (variant === 'EU') {
    startDay = Math.min(startDay, 30)
    endDay = Math.min(endDay, 30)
  } else {
    if (startDay === 31) startDay = 30
    // Only pull the end date back once the start has been normalised to 30.
    if (endDay === 31 && startDay >= 30) endDay = 30
  }

  return 360 * (to.year - from.year) + 30 * (to.month - from.month) + (endDay - startDay)
}

/**
 * The fraction of a year between two dates, under a given convention.
 *
 * Multiply by the annual rate to get the period's interest factor.
 */
export function yearFraction(
  from: LocalDate,
  to: LocalDate,
  convention: DayCountConvention,
): number {
  switch (convention) {
    case 'MONTHLY_NOMINAL': {
      // Whole months only: every period is a clean 1/12, so the annuity instalment
      // stays genuinely constant between rate resets.
      //
      // The end-of-month test matters more than it looks. A loan with a payment day
      // of the 31st has its February payment clamped to the 28th (see
      // `paymentDateFor`), so consecutive payment dates run 31 -> 28. Comparing day
      // numbers alone would score that as a partial month and drop a twelfth of a
      // year of interest from every short month.
      const endsOnLastDayOfMonth = to.day === daysInMonth(to.year, to.month)
      const partialMonth = to.day >= from.day || endsOnLastDayOfMonth ? 0 : -1
      const months =
        (to.year - from.year) * MONTHS_PER_YEAR + (to.month - from.month) + partialMonth
      return months / MONTHS_PER_YEAR
    }
    case 'ACT_360': {
      return daysBetween(from, to) / 360
    }
    case 'ACT_365': {
      return daysBetween(from, to) / 365
    }
    case 'THIRTY_360_EU': {
      return thirty360Days(from, to, 'EU') / 360
    }
    case 'THIRTY_360_US': {
      return thirty360Days(from, to, 'US') / 360
    }
  }
}

/**
 * Days of the first period that `MONTHLY_NOMINAL` does not charge for.
 *
 * The gap between drawdown and the first instalment is the one period in a schedule that is
 * almost never a whole month — money is drawn when the sale completes, and the first payment
 * falls on the agreed day of some later month. `MONTHLY_NOMINAL` counts whole months and
 * discards what is left over. For every other period that is exactly right, because payment
 * dates share a day of the month and each really is one month. For this one it silently drops
 * real interest.
 *
 * A drawdown on 27 September against a first payment on 20 November spans 54 days and is
 * charged as one month, so 24 days vanish — on a €125,000 balance at 4%, about €330. That is
 * not something a reader would catch by eye, which is why it is computed rather than left as
 * a general warning about day counts.
 *
 * Measured by advancing the drawdown date by however many whole months the convention
 * counted and seeing how far short of the due date that lands, rather than by comparing year
 * fractions — a nominal month is 30.4 days, so any comparison against elapsed days reports a
 * day or two of phantom shortfall on every ordinary 31-day period.
 *
 * @returns whole days dropped; `0` when the convention charges the period in full.
 */
export function nominalStubShortfallDays(drawdownDate: LocalDate, firstDueDate: LocalDate): number {
  const wholeMonths = Math.round(
    yearFraction(drawdownDate, firstDueDate, 'MONTHLY_NOMINAL') * MONTHS_PER_YEAR,
  )
  return Math.max(0, daysBetween(addMonthsToDate(drawdownDate, wholeMonths), firstDueDate))
}
