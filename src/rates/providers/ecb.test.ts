import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import {
  createEcbProvider,
  ECB_EARLIEST_PERIOD,
  ECB_PROVIDER_ID,
  ecbSeriesKey,
  parseEcbCsv,
} from '@/rates/providers/ecb'
import {
  ECB_CSV_12M_2021,
  ECB_CSV_EMPTY,
  ECB_CSV_WITH_GAP,
  recordingFetch,
  stubFetch,
} from '@/rates/testing/ecb-response'
import { RateProviderError } from '@/rates/types'

const provider = (fetchImpl: typeof globalThis.fetch) =>
  createEcbProvider({ fetch: fetchImpl, now: () => new Date('2026-08-14T10:00:00.000Z') })

const request = { tenor: '12M', from: yearMonth(2021, 1), to: yearMonth(2021, 4) } as const

describe('parseEcbCsv', () => {
  it('extracts observations from a real response', () => {
    const points = parseEcbCsv(ECB_CSV_12M_2021)

    expect(points).toHaveLength(4)
    expect(points[0]).toEqual({ period: yearMonth(2021, 1), rate: -0.005_047 })
    expect(points.at(-1)).toEqual({ period: yearMonth(2021, 4), rate: -0.004_835 })
  })

  it('converts percentages to fractions', () => {
    // The ECB publishes -0.5047 meaning -0.5047%, which the engine needs as -0.005047.
    expect(parseEcbCsv(ECB_CSV_12M_2021)[0]!.rate).toBeCloseTo(-0.005_047, 12)
  })

  it('is not fooled by commas inside the quoted title columns', () => {
    // "Historical close, average of observations through period" contains a comma. A
    // naive split would shift every later field and mis-read the observation.
    const points = parseEcbCsv(ECB_CSV_12M_2021)
    expect(points.every((point) => Number.isFinite(point.rate))).toBe(true)
    expect(points.every((point) => Math.abs(point.rate) < 0.1)).toBe(true)
  })

  it('skips periods published with no observation rather than reading them as zero', () => {
    const points = parseEcbCsv(ECB_CSV_WITH_GAP)
    expect(points.map((point) => point.period)).toEqual([yearMonth(2021, 1), yearMonth(2021, 3)])
  })

  it('returns nothing for a header-only response', () => {
    expect(parseEcbCsv(ECB_CSV_EMPTY)).toEqual([])
  })

  it('returns observations in ascending period order', () => {
    const shuffled = ECB_CSV_12M_2021.split('\n')
    const header = shuffled[0]!
    const reversed = [header, ...shuffled.slice(1).filter(Boolean).toReversed()].join('\n')

    const points = parseEcbCsv(reversed)
    expect(points.map((point) => point.period)).toEqual([
      yearMonth(2021, 1),
      yearMonth(2021, 2),
      yearMonth(2021, 3),
      yearMonth(2021, 4),
    ])
  })

  it('rejects a response whose columns it does not recognise', () => {
    expect(() => parseEcbCsv('SOMETHING,ELSE\n1,2')).toThrow(RateProviderError)
    expect(() => parseEcbCsv('')).toThrow(RateProviderError)
  })
})

describe('createEcbProvider', () => {
  it('describes itself for the UI', () => {
    const ecb = provider(stubFetch(ECB_CSV_12M_2021))

    expect(ecb.id).toBe(ECB_PROVIDER_ID)
    expect(ecb.supportedTenors).toEqual(['1M', '3M', '6M', '12M'])
    expect(ecb.earliestPeriod).toBe(ECB_EARLIEST_PERIOD)
    expect(ecb.earliestPeriod).toBe(yearMonth(1999, 1))
    // Drives the privacy note: this is the one provider that leaves the device.
    expect(ecb.requiresNetwork).toBe(true)
    // A key, not a literal — provider names are shown in the UI.
    expect(ecb.labelKey).toMatch(/^rates:/)
  })

  it('fetches the series and stamps when it was retrieved', async () => {
    const series = await provider(stubFetch(ECB_CSV_12M_2021)).getSeries(request)

    expect(series.providerId).toBe(ECB_PROVIDER_ID)
    expect(series.tenor).toBe('12M')
    expect(series.points).toHaveLength(4)
    expect(series.retrievedAt).toBe('2026-08-14T10:00:00.000Z')
  })

  it('requests the right series key and date range', async () => {
    const recorder = recordingFetch(ECB_CSV_12M_2021)
    await provider(recorder.fetch).getSeries(request)

    const [url] = recorder.calls
    expect(url).toContain('/FM/M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA')
    expect(url).toContain('format=csvdata')
    expect(url).toContain('startPeriod=2021-01')
    expect(url).toContain('endPeriod=2021-04')
  })

  it('uses the ECB name for the 12-month series, not the obvious guess', async () => {
    // The ECB calls it EURIBOR1YD_, not EURIBOR12MD_. Getting this wrong returns an
    // empty series rather than an error, so it would look like missing data.
    expect(ecbSeriesKey('12M')).toContain('EURIBOR1YD_')
    expect(ecbSeriesKey('1M')).toContain('EURIBOR1MD_')
    expect(ecbSeriesKey('3M')).toContain('EURIBOR3MD_')
    expect(ecbSeriesKey('6M')).toContain('EURIBOR6MD_')

    const recorder = recordingFetch(ECB_CSV_12M_2021)
    await provider(recorder.fetch).getSeries(request)
    expect(recorder.calls[0]).not.toContain('EURIBOR12MD_')
  })

  it('reports an HTTP failure with the status', async () => {
    const failing = provider(stubFetch('', { status: 503, statusText: 'Service Unavailable' }))
    await expect(failing.getSeries(request)).rejects.toThrow(/503 Service Unavailable/)
    await expect(failing.getSeries(request)).rejects.toBeInstanceOf(RateProviderError)
  })

  it('suggests the snapshot fallback when the network is unreachable', async () => {
    const offline = provider(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')))
    await expect(offline.getSeries(request)).rejects.toThrow(/snapshot/i)
  })

  it('preserves the underlying error as the cause', async () => {
    const underlying = new Error('getaddrinfo ENOTFOUND')
    const offline = provider(() => Promise.reject(underlying))

    await expect(offline.getSeries(request)).rejects.toMatchObject({ cause: underlying })
  })

  it('treats an empty series as an error rather than a silent absence', async () => {
    // A 200 with no observations means the key or the range is wrong. Returning an empty
    // series would surface much later as an unexplained MissingRateError.
    const empty = provider(stubFetch(ECB_CSV_EMPTY))
    await expect(empty.getSeries(request)).rejects.toThrow(/No 12M observations/)
  })

  it('passes an abort signal through', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | null | undefined

    const spy: typeof globalThis.fetch = (_input, init) => {
      receivedSignal = init?.signal
      return Promise.resolve(new Response(ECB_CSV_12M_2021, { status: 200 }))
    }

    await provider(spy).getSeries({ ...request, signal: controller.signal })
    expect(receivedSignal).toBe(controller.signal)
  })
})
