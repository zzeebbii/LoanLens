import type { YearMonth } from '@/domain/dates'
import type { Money } from '@/domain/money'
import type { PaymentRow } from '@/domain/schedule'

import { yearOf } from '@/domain/dates'
import { add, toMajorUnits } from '@/domain/money'

/**
 * Turning exact schedule rows into numbers a chart library can plot.
 *
 * This is the one place `Money` becomes a `number`, and it is a deliberate,
 * contained loss. Recharts computes pixel positions in floating point, so exactness
 * cannot survive the trip regardless — what matters is that the *displayed* figures
 * come from `Money` through `Intl`, and only the geometry comes from here.
 *
 * Nothing downstream of this module may feed a chart datum back into a calculation.
 * The exact value travels alongside as `Money` for the tooltip and the table.
 */

/** A charted month. Numbers position the marks; the `Money` fields render the labels. */
export interface ScheduleDatum {
  readonly period: YearMonth
  readonly year: number
  readonly index: number
  /** Plotted values, in major units. */
  readonly capital: number
  readonly interest: number
  readonly fees: number
  readonly balance: number
  readonly totalPaid: number
  readonly rate: number
  readonly referenceRate: number | null
  /** Exact values, for anything a reader will actually read. */
  readonly exact: {
    readonly capital: Money
    readonly interest: Money
    readonly fees: Money
    readonly balance: Money
    readonly totalPaid: Money
  }
}

export function toScheduleData(rows: readonly PaymentRow[]): ScheduleDatum[] {
  return rows.map((row) => ({
    period: row.period,
    year: yearOf(row.period),
    index: row.index,
    // Capital and the overpayment both retire principal, so the chart shows them as one
    // band. Splitting them would suggest the overpayment is a different kind of cost.
    capital: toMajorUnits(add(row.capital, row.extraPayment)),
    interest: toMajorUnits(row.interest),
    fees: toMajorUnits(row.fees),
    balance: toMajorUnits(row.closingBalance),
    totalPaid: toMajorUnits(row.totalPaid),
    rate: row.annualRate,
    referenceRate: row.referenceRate,
    exact: {
      capital: add(row.capital, row.extraPayment),
      interest: row.interest,
      fees: row.fees,
      balance: row.closingBalance,
      totalPaid: row.totalPaid,
    },
  }))
}

/**
 * Thins a series to at most `limit` points, always keeping the first and last.
 *
 * A 360-point line is more marks than a chart a few hundred pixels wide can show, and
 * plotting them all costs render time for detail nobody can see. The endpoints are kept
 * because they carry the two facts a reader looks for: where it started and where it ends.
 *
 * Only ever applied to *plotted geometry*. The table view and the tooltip read the full
 * series, so no value becomes unreachable.
 */
export function thin<T>(series: readonly T[], limit: number): T[] {
  if (series.length <= limit) return [...series]

  const step = (series.length - 1) / (limit - 1)
  const thinned: T[] = []

  for (let index = 0; index < limit; index += 1) {
    thinned.push(series[Math.round(index * step)] as T)
  }

  return thinned
}

/** Every calendar year the schedule touches, for axis ticks. */
export function yearTicks(data: readonly ScheduleDatum[], maxTicks = 8): YearMonth[] {
  const firstOfYear = new Map<number, YearMonth>()
  for (const datum of data) {
    if (!firstOfYear.has(datum.year)) firstOfYear.set(datum.year, datum.period)
  }

  const periods = [...firstOfYear.values()]
  return periods.length <= maxTicks ? periods : thin(periods, maxTicks)
}
