import type { YearMonth } from '@/domain/dates'
import type { RatePoint, RateSeries } from '@/rates/types'

import { addMonths, compareYearMonth, monthsBetween } from '@/domain/dates'
import { bpsToRate } from '@/domain/loan'
import { lastPeriod, lastRate, normalisePoints } from '@/rates/series'

/**
 * Extending a rate series past the published data.
 *
 * The engine refuses to invent a future rate (ADR 0001), which leaves the question here,
 * where it belongs: what happens beyond the last fixing is a *user's assumption*, not a
 * fact, and the app should say so rather than bury a default in a calculation.
 *
 * Every assumption is a named, selectable option so the UI can label a projection with
 * the assumption behind it.
 */

export const FORECAST_KINDS = ['HOLD_LAST', 'SHOCK', 'FIXED', 'CURVE'] as const

export type ForecastKind = (typeof FORECAST_KINDS)[number]

export type ForecastAssumption =
  /** The last published fixing continues unchanged. The most defensible default. */
  | { readonly kind: 'HOLD_LAST' }
  /**
   * The last fixing plus a shift, in basis points. Negative shifts model a cut.
   * This is what drives the rate-sensitivity fan chart: −100, base, +100, +200.
   */
  | { readonly kind: 'SHOCK'; readonly deltaBps: number }
  /** A flat rate the user names outright. */
  | { readonly kind: 'FIXED'; readonly rate: number }
  /**
   * An explicit path. Periods beyond the last supplied point hold that point's value,
   * so a short curve does not silently fall back to the published fixing.
   */
  | { readonly kind: 'CURVE'; readonly points: readonly RatePoint[] }

export const DEFAULT_FORECAST: ForecastAssumption = { kind: 'HOLD_LAST' }

/** How far past the last fixing a projection needs to reach. */
export interface ForecastHorizon {
  readonly through: YearMonth
}

/**
 * Appends projected points so the series covers every period through `horizon.through`.
 *
 * Published fixings are never overwritten — a forecast only ever extends the tail. That
 * keeps a reconstructed history factual even when the same series is also being used to
 * project forward.
 */
export function extend(
  series: RateSeries,
  assumption: ForecastAssumption,
  horizon: ForecastHorizon,
): RateSeries {
  const lastKnownPeriod = lastPeriod(series)
  const lastKnownRate = lastRate(series)

  // With no published data at all there is nothing to anchor HOLD_LAST or SHOCK to, so
  // only the assumptions that name their own rate can produce anything.
  if (lastKnownPeriod === null || lastKnownRate === null) {
    return extendFromNothing(series, assumption, horizon)
  }

  if (compareYearMonth(lastKnownPeriod, horizon.through) >= 0) {
    return series
  }

  const months = monthsBetween(lastKnownPeriod, horizon.through)
  const projected: RatePoint[] = []

  for (let offset = 1; offset <= months; offset += 1) {
    const period = addMonths(lastKnownPeriod, offset)
    projected.push({ period, rate: projectedRate(assumption, period, lastKnownRate) })
  }

  return { ...series, points: [...series.points, ...projected] }
}

function extendFromNothing(
  series: RateSeries,
  assumption: ForecastAssumption,
  horizon: ForecastHorizon,
): RateSeries {
  if (assumption.kind === 'FIXED') {
    // Fabricate a single point; carry-forward in `rateAt` covers everything after it.
    return { ...series, points: [{ period: horizon.through, rate: assumption.rate }] }
  }
  if (assumption.kind === 'CURVE') {
    return { ...series, points: normalisePoints(assumption.points) }
  }
  return series
}

function projectedRate(
  assumption: ForecastAssumption,
  period: YearMonth,
  lastKnownRate: number,
): number {
  switch (assumption.kind) {
    case 'HOLD_LAST': {
      return lastKnownRate
    }
    case 'SHOCK': {
      return lastKnownRate + bpsToRate(assumption.deltaBps)
    }
    case 'FIXED': {
      return assumption.rate
    }
    case 'CURVE': {
      const curve = normalisePoints(assumption.points)
      let resolved: number | null = null
      for (const point of curve) {
        if (compareYearMonth(point.period, period) > 0) break
        resolved = point.rate
      }
      // Before the curve starts, the last published fixing still applies.
      return resolved ?? lastKnownRate
    }
  }
}

/**
 * Basis-point shifts for the rate-sensitivity fan.
 *
 * Asymmetric on purpose. Rates rising hurts a borrower and rates falling merely helps, so
 * the upside deserves more of the chart than the downside.
 */
export const SENSITIVITY_SHOCKS_BPS = [-100, 0, 100, 200, 300] as const

/** Builds one shocked variant of a series per shift, for the fan chart. */
export function sensitivitySeries(
  series: RateSeries,
  horizon: ForecastHorizon,
  shocksBps: readonly number[] = SENSITIVITY_SHOCKS_BPS,
): { deltaBps: number; series: RateSeries }[] {
  return shocksBps.map((deltaBps) => ({
    deltaBps,
    series: extend(series, { kind: 'SHOCK', deltaBps }, horizon),
  }))
}
