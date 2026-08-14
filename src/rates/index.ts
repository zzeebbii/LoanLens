import type { RateProvider } from '@/rates/types'

import { createEcbProvider } from '@/rates/providers/ecb'
import { createSnapshotProvider } from '@/rates/providers/snapshot'
import { RateProviderRegistry } from '@/rates/registry'

export type { RatePoint, RateProvider, RateSeries, RateSeriesRequest } from '@/rates/types'
export { RateProviderError } from '@/rates/types'

export type { ForecastAssumption, ForecastHorizon, ForecastKind } from '@/rates/forecast'
export {
  DEFAULT_FORECAST,
  extend,
  FORECAST_KINDS,
  SENSITIVITY_SHOCKS_BPS,
  sensitivitySeries,
} from '@/rates/forecast'

export {
  firstPeriod,
  lastPeriod,
  lastRate,
  normalisePoints,
  rateAt,
  resolverFor,
  slice,
} from '@/rates/series'

export { RateProviderRegistry } from '@/rates/registry'

export {
  createEcbProvider,
  ECB_EARLIEST_PERIOD,
  ECB_PROVIDER_ID,
  ecbSeriesKey,
} from '@/rates/providers/ecb'
export { createManualProvider, MANUAL_PROVIDER_ID } from '@/rates/providers/manual'
export {
  createSnapshotProvider,
  parseSnapshot,
  SNAPSHOT_PROVIDER_ID,
  snapshotSchema,
} from '@/rates/providers/snapshot'

export interface DefaultRegistryOptions {
  readonly fetch?: typeof globalThis.fetch
  /** Where the bundled snapshot lives, relative to the app's base path. */
  readonly snapshotUrl?: string
}

/**
 * The providers the app ships with.
 *
 * The snapshot is registered alongside the ECB rather than only as an error path: it is
 * the fast, offline, zero-network source, and the ECB is what refreshes beyond it. The
 * manual provider is not registered here because it is constructed from user data at the
 * point of use.
 */
export function createDefaultRegistry(options: DefaultRegistryOptions = {}): RateProviderRegistry {
  const providers: RateProvider[] = [
    createEcbProvider(options.fetch === undefined ? {} : { fetch: options.fetch }),
    createSnapshotProvider({
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.snapshotUrl === undefined ? {} : { url: options.snapshotUrl }),
    }),
  ]

  const registry = new RateProviderRegistry()
  for (const provider of providers) registry.register(provider)
  return registry
}
