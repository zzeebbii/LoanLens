import type { Tenor } from '@/domain/loan'
import type { RatePoint, RateProvider, RateSeries, RateSeriesRequest } from '@/rates/types'

import { z } from 'zod'

import { parseYearMonth, yearMonth } from '@/domain/dates'
import { TENORS } from '@/domain/loan'
import { normalisePoints, slice } from '@/rates/series'
import { RateProviderError } from '@/rates/types'

/**
 * EURIBOR from a JSON file committed to the repository.
 *
 * Earns its place three times over:
 *
 *  - **First paint.** The file ships with the build, so the app can render a reconstructed
 *    history immediately instead of waiting on a round trip to Frankfurt.
 *  - **Degraded mode.** If the ECB is unreachable, or ever stops serving permissive CORS
 *    headers, the app keeps working on data that is at most a month stale.
 *  - **Offline.** After first load there is nothing left to fetch.
 *
 * The file is refreshed by a scheduled workflow. It is treated as untrusted input and
 * validated on load: a truncated deploy or a failed refresh should surface as a clear
 * error, not as a schedule quietly computed from half a series.
 */

export const SNAPSHOT_PROVIDER_ID = 'snapshot'

const DEFAULT_SNAPSHOT_URL = 'data/euribor.json'

const yearMonthSchema = z.string().refine((value) => parseYearMonth(value) !== null, {
  message: 'Expected a YYYY-MM period',
})

/**
 * Rates are stored as percentages, matching how the ECB publishes them and how a human
 * reading the file would expect to see them. Conversion to a fraction happens on load.
 *
 * The bounds are a sanity check, not a forecast: EURIBOR has ranged from about −0.6% to
 * 5.4% since 1999, and a value outside −25% to 100% means the units are wrong.
 */
const observationSchema = z.object({
  period: yearMonthSchema,
  ratePercent: z.number().finite().min(-25).max(100),
})

export const snapshotSchema = z.object({
  /** Bumped only on a breaking change to this shape. */
  schemaVersion: z.literal(1),
  source: z.string().min(1),
  retrievedAt: z.string().min(1),
  // `partialRecord`, not `record`: with an enum key, `z.record` demands every tenor be
  // present. A snapshot carrying only the tenors a user's loans actually reference is
  // legitimate, and a refresh that adds a tenor should not invalidate older files.
  // Unknown tenors are still rejected, and an empty array still fails.
  series: z.partialRecord(z.enum(TENORS), z.array(observationSchema).min(1)),
})

export type RateSnapshot = z.infer<typeof snapshotSchema>

export interface SnapshotProviderOptions {
  /** Pre-loaded snapshot. Supply this to skip fetching entirely. */
  readonly snapshot?: RateSnapshot
  /** Relative to the app's base path, so it works under a GitHub Pages subdirectory. */
  readonly url?: string
  readonly fetch?: typeof globalThis.fetch
}

/** Validates a parsed snapshot, converting percentages to fractions. */
export function toSeriesMap(snapshot: RateSnapshot): Map<Tenor, RatePoint[]> {
  const byTenor = new Map<Tenor, RatePoint[]>()

  for (const [tenor, observations] of Object.entries(snapshot.series)) {
    if (observations === undefined) continue
    byTenor.set(
      tenor as Tenor,
      normalisePoints(
        observations.map((observation) => ({
          // Already validated as parseable by the schema.
          period: parseYearMonth(observation.period) ?? yearMonth(1999, 1),
          rate: observation.ratePercent / 100,
        })),
      ),
    )
  }

  return byTenor
}

/** Parses and validates raw snapshot JSON, with an error a human can act on. */
export function parseSnapshot(raw: unknown): RateSnapshot {
  const result = snapshotSchema.safeParse(raw)

  if (!result.success) {
    throw new RateProviderError(
      SNAPSHOT_PROVIDER_ID,
      `Bundled rate snapshot is invalid: ${result.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
      { cause: result.error },
    )
  }

  return result.data
}

export function createSnapshotProvider(options: SnapshotProviderOptions = {}): RateProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const url = options.url ?? DEFAULT_SNAPSHOT_URL

  // Loaded once and shared. The file is immutable for the lifetime of a deploy, so
  // re-fetching it per request would be pure waste.
  let loading: Promise<Map<Tenor, RatePoint[]>> | null = null

  function load(): Promise<Map<Tenor, RatePoint[]>> {
    if (options.snapshot !== undefined) {
      return Promise.resolve(toSeriesMap(options.snapshot))
    }

    loading ??= (async () => {
      let response: Response
      try {
        response = await fetchImpl(url)
      } catch (cause) {
        throw new RateProviderError(SNAPSHOT_PROVIDER_ID, `Could not load ${url}.`, { cause })
      }
      if (!response.ok) {
        throw new RateProviderError(
          SNAPSHOT_PROVIDER_ID,
          `Could not load ${url}: ${response.status} ${response.statusText}.`,
        )
      }
      return toSeriesMap(parseSnapshot(await response.json()))
    })().catch((error: unknown) => {
      // Do not cache a failure: a transient error should not disable the fallback for
      // the rest of the session.
      loading = null
      throw error
    })

    return loading
  }

  return {
    id: SNAPSHOT_PROVIDER_ID,
    labelKey: 'rates:provider.snapshot.label',
    supportedTenors: TENORS,
    earliestPeriod: yearMonth(1999, 1),
    // Reads a file shipped with the app, from the same origin. Nothing leaves the device.
    requiresNetwork: false,

    async getSeries({ tenor, from, to }: RateSeriesRequest): Promise<RateSeries> {
      const byTenor = await load()
      const points = byTenor.get(tenor)

      if (points === undefined) {
        throw new RateProviderError(
          SNAPSHOT_PROVIDER_ID,
          `Snapshot has no ${tenor} series. It may have been refreshed incompletely.`,
        )
      }

      return slice(
        {
          providerId: SNAPSHOT_PROVIDER_ID,
          tenor,
          points,
          retrievedAt: options.snapshot?.retrievedAt ?? null,
        },
        from,
        to,
      )
    },
  }
}
