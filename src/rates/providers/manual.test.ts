import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { createManualProvider, MANUAL_PROVIDER_ID } from '@/rates/providers/manual'
import { rateAt } from '@/rates/series'

const fixings = {
  '12M': [
    { period: yearMonth(2023, 1), rate: 0.035 },
    { period: yearMonth(2022, 1), rate: 0.01 },
  ],
} as const

describe('createManualProvider', () => {
  it('serves the fixings the user entered', async () => {
    const provider = createManualProvider({ fixings })
    const series = await provider.getSeries({
      tenor: '12M',
      from: yearMonth(2020, 1),
      to: yearMonth(2030, 1),
    })

    expect(series.points).toHaveLength(2)
    expect(rateAt(series, yearMonth(2022, 6))).toBeCloseTo(0.01, 12)
  })

  it('sorts what the user typed, so entry order does not matter', () => {
    const provider = createManualProvider({ fixings })
    expect(provider.earliestPeriod).toBe(yearMonth(2022, 1))
  })

  it('makes no network request', () => {
    expect(createManualProvider({ fixings }).requiresNetwork).toBe(false)
  })

  it('reports no retrieval time, because nothing was retrieved', async () => {
    // Staleness is meaningless for data the user maintains themselves.
    const series = await createManualProvider({ fixings }).getSeries({
      tenor: '12M',
      from: yearMonth(2020, 1),
      to: yearMonth(2030, 1),
    })
    expect(series.retrievedAt).toBeNull()
  })

  it('supports only the tenors it was given data for', () => {
    expect(createManualProvider({ fixings }).supportedTenors).toEqual(['12M'])
  })

  it('returns an empty series for an unsupported tenor rather than throwing', async () => {
    // Nothing is broken — the user simply has not entered 3M figures. The engine turns
    // the resulting null into a MissingRateError naming the period.
    const series = await createManualProvider({ fixings }).getSeries({
      tenor: '3M',
      from: yearMonth(2020, 1),
      to: yearMonth(2030, 1),
    })
    expect(series.points).toEqual([])
  })

  it('restricts to the requested range', async () => {
    const series = await createManualProvider({ fixings }).getSeries({
      tenor: '12M',
      from: yearMonth(2022, 6),
      to: yearMonth(2030, 1),
    })
    expect(series.points.map((point) => point.period)).toEqual([yearMonth(2023, 1)])
  })

  it('can be registered under a custom id, so several curves coexist', () => {
    // A user tracking two references by hand needs two distinct provider ids.
    const provider = createManualProvider({
      fixings,
      id: 'my-bank',
      labelKey: 'rates:provider.custom.label',
    })
    expect(provider.id).toBe('my-bank')
    expect(provider.labelKey).toBe('rates:provider.custom.label')
  })

  it('defaults to the standard id and label key', () => {
    const provider = createManualProvider({ fixings })
    expect(provider.id).toBe(MANUAL_PROVIDER_ID)
    expect(provider.labelKey).toMatch(/^rates:provider\./)
  })

  it('copes with no fixings at all', async () => {
    const provider = createManualProvider({ fixings: {} })
    expect(provider.supportedTenors).toEqual([])
    expect(provider.earliestPeriod).toBe(yearMonth(1999, 1))

    const series = await provider.getSeries({
      tenor: '12M',
      from: yearMonth(2020, 1),
      to: yearMonth(2030, 1),
    })
    expect(series.points).toEqual([])
  })
})
