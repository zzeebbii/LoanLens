import type { YearMonth } from '@/domain/dates'
import type { Tenor } from '@/domain/loan'

/**
 * The rate-provider abstraction.
 *
 * Rate data is behind an interface so a user can plug in their own source — a different
 * index, a national statistics API, a spreadsheet they maintain by hand — without
 * touching the engine. See docs/rate-providers.md for how to implement one.
 *
 * Nothing here imports from the engine beyond types, and the engine imports nothing from
 * here: `domain/` receives rates as a plain function.
 */

/** One published fixing. `rate` is a fraction, so 2.855% is `0.02855`. */
export interface RatePoint {
  readonly period: YearMonth
  readonly rate: number
}

export interface RateSeries {
  readonly providerId: string
  readonly tenor: Tenor
  /** Ascending by period, with no duplicates. Gaps are allowed and carried forward. */
  readonly points: readonly RatePoint[]
  /** ISO 8601 instant the data was fetched, for showing staleness. */
  readonly retrievedAt: string | null
}

export interface RateSeriesRequest {
  readonly tenor: Tenor
  readonly from: YearMonth
  readonly to: YearMonth
  readonly signal?: AbortSignal
}

export interface RateProvider {
  /** Stable identifier, referenced by `ReferenceIndex.providerId` on a loan. */
  readonly id: string
  /** i18n key for the display name. Never a literal — providers are shown in the UI. */
  readonly labelKey: string
  readonly supportedTenors: readonly Tenor[]
  /** Earliest period this provider can supply, for bounding the UI's date pickers. */
  readonly earliestPeriod: YearMonth
  /**
   * Whether using this provider makes a network request. Drives the privacy note in the
   * UI: a user should be able to see at a glance which sources leave the device.
   */
  readonly requiresNetwork: boolean
  getSeries(request: RateSeriesRequest): Promise<RateSeries>
}

/** Thrown when a provider cannot supply data. Carries the provider for the error message. */
export class RateProviderError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${providerId}] ${message}`, options)
    this.name = 'RateProviderError'
  }
}
