import type { Tenor } from '@/domain/loan'
import type { RatePoint, RateProvider, RateSeries, RateSeriesRequest } from '@/rates/types'

import { yearMonth } from '@/domain/dates'
import { normalisePoints, slice } from '@/rates/series'

/**
 * Fixings the user entered themselves.
 *
 * Exists for the cases the ECB cannot cover: a reference the app does not fetch, a rate
 * negotiated outside the published index, or a user who has the figures from their own
 * statements and would rather type them than trust a reconstruction.
 *
 * Makes no network request, which the UI surfaces via `requiresNetwork`.
 */

export const MANUAL_PROVIDER_ID = 'manual'

export interface ManualProviderOptions {
  /** Fixings per tenor. Sparse is fine — gaps carry forward. */
  readonly fixings: Partial<Readonly<Record<Tenor, readonly RatePoint[]>>>
  readonly id?: string
  readonly labelKey?: string
}

export function createManualProvider({
  fixings,
  id = MANUAL_PROVIDER_ID,
  labelKey = 'rates:provider.manual.label',
}: ManualProviderOptions): RateProvider {
  const normalised = new Map<Tenor, RatePoint[]>()
  for (const [tenor, points] of Object.entries(fixings)) {
    if (points !== undefined) normalised.set(tenor as Tenor, normalisePoints(points))
  }

  const supportedTenors = [...normalised.keys()]
  const earliest = [...normalised.values()]
    .map((points) => points[0]?.period)
    .filter((period): period is NonNullable<typeof period> => period !== undefined)
    .toSorted()

  return {
    id,
    labelKey,
    supportedTenors,
    earliestPeriod: earliest[0] ?? yearMonth(1999, 1),
    requiresNetwork: false,

    getSeries({ tenor, from, to }: RateSeriesRequest): Promise<RateSeries> {
      const series: RateSeries = {
        providerId: id,
        tenor,
        points: normalised.get(tenor) ?? [],
        // User-entered data is not "retrieved", so there is no staleness to report.
        retrievedAt: null,
      }
      return Promise.resolve(slice(series, from, to))
    },
  }
}
