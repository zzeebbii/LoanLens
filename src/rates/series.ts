import type { YearMonth } from '@/domain/dates'
import type { ReferenceIndex } from '@/domain/loan'
import type { ReferenceRateAt } from '@/domain/schedule'
import type { RatePoint, RateSeries } from '@/rates/types'

import { compareYearMonth } from '@/domain/dates'

/**
 * Turning published fixings into the function the engine wants.
 *
 * This module is the bridge described in ADR 0001: `domain/` receives
 * `(period, index) => number | null` and knows nothing about where the numbers came
 * from. Everything asynchronous has already happened by the time a resolver exists.
 */

/** Sorts ascending and drops duplicate periods, keeping the last occurrence. */
export function normalisePoints(points: readonly RatePoint[]): RatePoint[] {
  const byPeriod = new Map<YearMonth, RatePoint>()
  for (const point of points) byPeriod.set(point.period, point)
  return [...byPeriod.values()].toSorted((a, b) => compareYearMonth(a.period, b.period))
}

/**
 * The fixing in force for `period`: the latest point at or before it.
 *
 * Carrying the previous value forward is not a convenience — it is how a reference rate
 * behaves. Fixings are published monthly and a loan resetting annually reads one of
 * twelve, so "the rate for June" means "the most recent fixing as of June".
 *
 * Returns `null` for a period earlier than the first fixing, since there is nothing to
 * carry forward from.
 */
export function rateAt(series: RateSeries, period: YearMonth): number | null {
  let resolved: number | null = null

  // Points are ascending, so the last one not after `period` wins.
  for (const point of series.points) {
    if (compareYearMonth(point.period, period) > 0) break
    resolved = point.rate
  }

  return resolved
}

export function firstPeriod(series: RateSeries): YearMonth | null {
  return series.points[0]?.period ?? null
}

export function lastPeriod(series: RateSeries): YearMonth | null {
  return series.points.at(-1)?.period ?? null
}

export function lastRate(series: RateSeries): number | null {
  return series.points.at(-1)?.rate ?? null
}

/**
 * Builds a `ReferenceRateAt` from one or more series, keyed by provider and tenor.
 *
 * Takes a collection so a portfolio with a 12M-linked mortgage and a 3M-linked
 * renovation loan resolves from a single function.
 */
export function resolverFor(series: readonly RateSeries[]): ReferenceRateAt {
  const byKey = new Map<string, RateSeries>()
  for (const entry of series) byKey.set(`${entry.providerId}:${entry.tenor}`, entry)

  return (period: YearMonth, index: ReferenceIndex) => {
    const match = byKey.get(`${index.providerId}:${index.tenor}`)
    return match === undefined ? null : rateAt(match, period)
  }
}

/** Restricts a series to `[from, to]` inclusive. */
export function slice(series: RateSeries, from: YearMonth, to: YearMonth): RateSeries {
  return {
    ...series,
    points: series.points.filter(
      (point) =>
        compareYearMonth(point.period, from) >= 0 && compareYearMonth(point.period, to) <= 0,
    ),
  }
}
