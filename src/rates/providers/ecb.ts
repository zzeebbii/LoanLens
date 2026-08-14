import type { YearMonth } from '@/domain/dates'
import type { Tenor } from '@/domain/loan'
import type { RatePoint, RateProvider, RateSeries, RateSeriesRequest } from '@/rates/types'

import { parseYearMonth, yearMonth } from '@/domain/dates'
import { normalisePoints } from '@/rates/series'
import { RateProviderError } from '@/rates/types'

/**
 * EURIBOR from the ECB Data Portal.
 *
 * The default provider, and the reason this app needs no backend: the ECB serves
 * `access-control-allow-origin: *`, so the browser can fetch it directly. Verified, and
 * recorded in docs/adr/0003-static-local-first-deployment.md.
 *
 * The request carries a public series key and a date range and nothing else — no loan
 * details, no identifiers.
 */

export const ECB_PROVIDER_ID = 'ecb'

const DEFAULT_BASE_URL = 'https://data-api.ecb.europa.eu/service/data/FM'

/**
 * ECB series keys, one per tenor.
 *
 * Note the 12-month key: the ECB calls it `EURIBOR1YD_`, not `EURIBOR12MD_`. Guessing the
 * pattern from the shorter tenors returns an empty series rather than an error, which is
 * exactly the kind of silent emptiness worth naming explicitly.
 *
 * `.HSTA` is the historical close, averaged over the period. `M.U2.EUR.RT.MM` selects
 * monthly, euro area, euro, Refinitiv, money market.
 */
const SERIES_KEYS: Readonly<Record<Tenor, string>> = {
  '1M': 'M.U2.EUR.RT.MM.EURIBOR1MD_.HSTA',
  '3M': 'M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA',
  '6M': 'M.U2.EUR.RT.MM.EURIBOR6MD_.HSTA',
  '12M': 'M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA',
}

/** EURIBOR begins with the euro. There is no data before this. */
export const ECB_EARLIEST_PERIOD = yearMonth(1999, 1)

export interface EcbProviderOptions {
  /**
   * Injected so tests can drive the parser without a network, and so the app can wrap it
   * in caching or retry without this module knowing.
   */
  readonly fetch?: typeof globalThis.fetch
  readonly baseUrl?: string
  /** Injected clock for `retrievedAt`; keeps tests deterministic. */
  readonly now?: () => Date
}

/**
 * Splits one CSV record, honouring quoted fields.
 *
 * The ECB response includes free-text columns (`TITLE`, `TITLE_COMPL`) containing commas,
 * so splitting on commas mangles every row. Doubled quotes are the RFC 4180 escape for a
 * literal quote.
 */
function splitCsvRecord(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        current += character
      }
    } else if (character === '"') {
      inQuotes = true
    } else if (character === ',') {
      fields.push(current)
      current = ''
    } else {
      current += character
    }
  }

  fields.push(current)
  return fields
}

/**
 * Parses an SDMX CSV response into fixings.
 *
 * Columns are located by header name rather than by position. The ECB response carries
 * around forty columns of metadata and the layout is not part of any contract we control;
 * an index that silently shifted would read a different column and report plausible
 * nonsense.
 *
 * `OBS_VALUE` is a percentage, so it is divided by 100 to give the fraction the engine
 * uses.
 */
export function parseEcbCsv(csv: string, providerId = ECB_PROVIDER_ID): RatePoint[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const header = lines[0]

  if (header === undefined) {
    throw new RateProviderError(providerId, 'Response was empty.')
  }

  const columns = splitCsvRecord(header)
  const periodIndex = columns.indexOf('TIME_PERIOD')
  const valueIndex = columns.indexOf('OBS_VALUE')

  if (periodIndex === -1 || valueIndex === -1) {
    throw new RateProviderError(
      providerId,
      `Response is missing TIME_PERIOD or OBS_VALUE. Columns seen: ${columns.slice(0, 12).join(', ')}…`,
    )
  }

  const points: RatePoint[] = []

  for (const line of lines.slice(1)) {
    const fields = splitCsvRecord(line)
    const rawPeriod = fields[periodIndex]?.trim()
    const rawValue = fields[valueIndex]?.trim()

    // A published period with no observation is normal — skip it and let carry-forward
    // handle the gap rather than inventing a zero.
    if (rawPeriod === undefined || rawValue === undefined || rawValue === '') continue

    const period = parseYearMonth(rawPeriod)
    if (period === null) continue

    const asPercent = Number(rawValue)
    if (!Number.isFinite(asPercent)) continue

    points.push({ period, rate: asPercent / 100 })
  }

  return normalisePoints(points)
}

export function createEcbProvider(options: EcbProviderOptions = {}): RateProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  const now = options.now ?? (() => new Date())

  return {
    id: ECB_PROVIDER_ID,
    labelKey: 'rates:provider.ecb.label',
    supportedTenors: ['1M', '3M', '6M', '12M'],
    earliestPeriod: ECB_EARLIEST_PERIOD,
    requiresNetwork: true,

    async getSeries({ tenor, from, to, signal }: RateSeriesRequest): Promise<RateSeries> {
      const key = SERIES_KEYS[tenor]
      const url = new URL(`${baseUrl}/${key}`)
      url.searchParams.set('format', 'csvdata')
      url.searchParams.set('startPeriod', from)
      url.searchParams.set('endPeriod', to)

      let response: Response
      try {
        response = await fetchImpl(url, {
          headers: { Accept: 'text/csv' },
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (cause) {
        throw new RateProviderError(
          ECB_PROVIDER_ID,
          'Could not reach the ECB Data Portal. Check your connection, or switch to the bundled snapshot.',
          { cause },
        )
      }

      if (!response.ok) {
        throw new RateProviderError(
          ECB_PROVIDER_ID,
          `ECB Data Portal returned ${response.status} ${response.statusText} for the ${tenor} series.`,
        )
      }

      const points = parseEcbCsv(await response.text())

      if (points.length === 0) {
        throw new RateProviderError(
          ECB_PROVIDER_ID,
          `No ${tenor} observations between ${from} and ${to}.`,
        )
      }

      return {
        providerId: ECB_PROVIDER_ID,
        tenor,
        points,
        retrievedAt: now().toISOString(),
      }
    },
  }
}

/** The series key for a tenor, exposed for the rate-refresh workflow and for docs. */
export function ecbSeriesKey(tenor: Tenor): string {
  return SERIES_KEYS[tenor]
}

/** Every period from `from` to `to` inclusive — used to check a response for gaps. */
export function periodsCovered(points: readonly RatePoint[]): YearMonth[] {
  return points.map((point) => point.period)
}
