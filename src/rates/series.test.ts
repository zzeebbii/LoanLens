import type { RatePoint, RateSeries } from '@/rates/types'

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import {
  firstPeriod,
  lastPeriod,
  lastRate,
  normalisePoints,
  rateAt,
  resolverFor,
  slice,
} from '@/rates/series'

function seriesOf(points: readonly RatePoint[], tenor: RateSeries['tenor'] = '12M'): RateSeries {
  return { providerId: 'test', tenor, points, retrievedAt: null }
}

const sparse = seriesOf([
  { period: yearMonth(2021, 1), rate: -0.005 },
  { period: yearMonth(2022, 6), rate: 0.01 },
  { period: yearMonth(2023, 1), rate: 0.035 },
])

describe('normalisePoints', () => {
  it('sorts ascending', () => {
    const points = normalisePoints([
      { period: yearMonth(2023, 1), rate: 0.03 },
      { period: yearMonth(2021, 5), rate: 0.01 },
      { period: yearMonth(2022, 2), rate: 0.02 },
    ])
    expect(points.map((point) => point.period)).toEqual([
      yearMonth(2021, 5),
      yearMonth(2022, 2),
      yearMonth(2023, 1),
    ])
  })

  it('keeps the last value for a duplicated period', () => {
    // A refreshed snapshot can restate a provisional fixing; the later value wins.
    const points = normalisePoints([
      { period: yearMonth(2021, 5), rate: 0.01 },
      { period: yearMonth(2021, 5), rate: 0.012 },
    ])
    expect(points).toEqual([{ period: yearMonth(2021, 5), rate: 0.012 }])
  })

  it('always returns a sorted, duplicate-free series', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            month: fc.integer({ min: 1, max: 12 }),
            year: fc.integer({ min: 1999, max: 2050 }),
            rate: fc.double({ min: -0.01, max: 0.06, noNaN: true, noDefaultInfinity: true }),
          }),
          { maxLength: 40 },
        ),
        (raw) => {
          const points = normalisePoints(
            raw.map((entry) => ({ period: yearMonth(entry.year, entry.month), rate: entry.rate })),
          )
          const periods = points.map((point) => point.period)
          expect(periods).toEqual(periods.toSorted())
          expect(new Set(periods).size).toBe(periods.length)
        },
      ),
    )
  })
})

describe('rateAt', () => {
  it('returns the fixing published in that exact period', () => {
    expect(rateAt(sparse, yearMonth(2022, 6))).toBeCloseTo(0.01, 12)
  })

  it('carries the most recent fixing forward across a gap', () => {
    // Not a convenience: a loan resetting annually reads one fixing in twelve, so "the
    // rate for October" means "the most recent fixing as of October".
    expect(rateAt(sparse, yearMonth(2021, 9))).toBeCloseTo(-0.005, 12)
    expect(rateAt(sparse, yearMonth(2022, 11))).toBeCloseTo(0.01, 12)
  })

  it('carries the last fixing forward indefinitely', () => {
    expect(rateAt(sparse, yearMonth(2040, 1))).toBeCloseTo(0.035, 12)
  })

  it('returns null before the first fixing, with nothing to carry forward from', () => {
    expect(rateAt(sparse, yearMonth(2020, 12))).toBeNull()
    expect(rateAt(seriesOf([]), yearMonth(2021, 1))).toBeNull()
  })

  it('never returns a value from a later period', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1999, max: 2050 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const period = yearMonth(year, month)
          const resolved = rateAt(sparse, period)
          if (resolved === null) return
          const source = sparse.points.findLast((point) => point.period <= period)
          expect(source?.rate).toBe(resolved)
        },
      ),
    )
  })
})

describe('boundaries', () => {
  it('reports the first and last periods and the last rate', () => {
    expect(firstPeriod(sparse)).toBe(yearMonth(2021, 1))
    expect(lastPeriod(sparse)).toBe(yearMonth(2023, 1))
    expect(lastRate(sparse)).toBeCloseTo(0.035, 12)
  })

  it('reports null for an empty series', () => {
    expect(firstPeriod(seriesOf([]))).toBeNull()
    expect(lastPeriod(seriesOf([]))).toBeNull()
    expect(lastRate(seriesOf([]))).toBeNull()
  })
})

describe('slice', () => {
  it('keeps the inclusive range', () => {
    const restricted = slice(sparse, yearMonth(2022, 1), yearMonth(2023, 1))
    expect(restricted.points.map((point) => point.period)).toEqual([
      yearMonth(2022, 6),
      yearMonth(2023, 1),
    ])
  })

  it('can produce an empty series', () => {
    expect(slice(sparse, yearMonth(2019, 1), yearMonth(2019, 12)).points).toEqual([])
  })
})

describe('resolverFor', () => {
  it('routes by provider and tenor', () => {
    const resolve = resolverFor([
      seriesOf([{ period: yearMonth(2021, 1), rate: 0.01 }], '12M'),
      seriesOf([{ period: yearMonth(2021, 1), rate: 0.02 }], '3M'),
    ])

    expect(resolve(yearMonth(2021, 6), { providerId: 'test', tenor: '12M' })).toBeCloseTo(0.01, 12)
    expect(resolve(yearMonth(2021, 6), { providerId: 'test', tenor: '3M' })).toBeCloseTo(0.02, 12)
  })

  it('returns null for a series it does not hold', () => {
    // A portfolio can reference a provider that was never registered — an import from
    // another device, say. The engine turns this into a MissingRateError naming the
    // period, which is a better failure than a silent zero.
    const resolve = resolverFor([sparse])
    expect(resolve(yearMonth(2021, 6), { providerId: 'other', tenor: '12M' })).toBeNull()
    expect(resolve(yearMonth(2021, 6), { providerId: 'test', tenor: '6M' })).toBeNull()
  })

  it('serves a portfolio spanning several tenors from one function', () => {
    const resolve = resolverFor([
      seriesOf([{ period: yearMonth(2021, 1), rate: 0.005 }], '12M'),
      seriesOf([{ period: yearMonth(2021, 1), rate: 0.001 }], '3M'),
    ])
    expect(resolve(yearMonth(2025, 1), { providerId: 'test', tenor: '12M' })).not.toBeNull()
    expect(resolve(yearMonth(2025, 1), { providerId: 'test', tenor: '3M' })).not.toBeNull()
  })
})
