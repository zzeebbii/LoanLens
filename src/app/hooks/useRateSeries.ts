import type { YearMonth } from '@/domain/dates'
import type { Loan, Tenor } from '@/domain/loan'
import type { ReferenceRateAt } from '@/domain/schedule'
import type { ForecastAssumption, RateSeries } from '@/rates'

import { useQuery } from '@tanstack/react-query'

import { useRateProviders } from '@/app/providers/RateProviderContext'
import { addMonths } from '@/domain/dates'
import { ECB_PROVIDER_ID, extend, resolverFor, SNAPSHOT_PROVIDER_ID } from '@/rates'

/**
 * Fetching rate data and turning it into the function the engine wants.
 *
 * This is the boundary ADR 0001 creates: everything asynchronous happens here, and what
 * reaches `replay` is a plain synchronous `(period, index) => number | null`.
 */

export const rateKeys = {
  series: (providerId: string, tenor: Tenor, from: YearMonth, to: YearMonth) =>
    ['rates', providerId, tenor, from, to] as const,
}

export interface UseRateSeriesOptions {
  readonly providerId: string
  readonly tenor: Tenor
  readonly from: YearMonth
  readonly to: YearMonth
}

/**
 * One series, with an automatic fall back to the bundled snapshot.
 *
 * The ECB being unreachable — offline, an outage, a CORS policy change — must not leave the
 * app unable to show a schedule. The snapshot is at most a month stale, which is far better
 * than nothing, and the caller is told which source answered so the UI can say so.
 */
export function useRateSeries({ providerId, tenor, from, to }: UseRateSeriesOptions) {
  const registry = useRateProviders()

  return useQuery({
    queryKey: rateKeys.series(providerId, tenor, from, to),
    queryFn: async (): Promise<{ series: RateSeries; usedFallback: boolean }> => {
      const provider = registry.get(providerId)

      try {
        return { series: await provider.getSeries({ tenor, from, to }), usedFallback: false }
      } catch (error) {
        const fallback = registry.find(SNAPSHOT_PROVIDER_ID)
        if (providerId === SNAPSHOT_PROVIDER_ID || fallback === undefined) throw error

        return { series: await fallback.getSeries({ tenor, from, to }), usedFallback: true }
      }
    },
    // Published monthly, so re-fetching within a session is pure waste.
    staleTime: 60 * 60 * 1000,
    retry: 1,
  })
}

/** The reference index a loan follows, or `null` for a fixed-rate loan. */
function referenceOf(loan: Loan) {
  return loan.rateBasis.kind === 'FLOATING' ? loan.rateBasis.reference : null
}

export interface UseLoanRatesOptions {
  readonly loan: Loan | null | undefined
  /** How to treat months past the published data. */
  readonly forecast: ForecastAssumption
  /** Furthest period the schedule could reach. Generous is fine; extending is cheap. */
  readonly horizon: YearMonth
}

export interface LoanRates {
  readonly rateAt: ReferenceRateAt
  readonly series: RateSeries | null
  readonly usedFallback: boolean
}

/**
 * The rate resolver for one loan, forecast applied.
 *
 * A fixed-rate loan needs no data at all, so this resolves immediately with a function that
 * is never called — rather than fetching a series nothing will read.
 */
export function useLoanRates({ loan, forecast, horizon }: UseLoanRatesOptions) {
  const reference = loan == null ? null : referenceOf(loan)

  const query = useRateSeries({
    providerId: reference?.providerId ?? ECB_PROVIDER_ID,
    tenor: reference?.tenor ?? '12M',
    from: loan?.firstPaymentPeriod ?? horizon,
    to: horizon,
  })

  // A fixed-rate loan resolves without waiting on anything.
  if (loan != null && reference === null) {
    return {
      ...query,
      isPending: false,
      isError: false,
      error: null,
      data: { rateAt: (() => null) as ReferenceRateAt, series: null, usedFallback: false },
    }
  }

  if (query.data === undefined) {
    return { ...query, data: undefined }
  }

  const extended = extend(query.data.series, forecast, { through: horizon })

  return {
    ...query,
    data: {
      rateAt: resolverFor([extended]),
      series: extended,
      usedFallback: query.data.usedFallback,
    } satisfies LoanRates,
  }
}

/** A horizon comfortably past the end of a loan, for bounding a rate request. */
export function horizonFor(loan: Loan, extraMonths = 24): YearMonth {
  return addMonths(loan.firstPaymentPeriod, loan.termMonths + extraMonths)
}
