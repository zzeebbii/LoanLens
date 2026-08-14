import type { RateSeries } from '@/rates/types'

import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { extend, SENSITIVITY_SHOCKS_BPS, sensitivitySeries } from '@/rates/forecast'
import { lastPeriod, rateAt } from '@/rates/series'

const published: RateSeries = {
  providerId: 'test',
  tenor: '12M',
  points: [
    { period: yearMonth(2025, 1), rate: 0.028 },
    { period: yearMonth(2026, 7), rate: 0.0285 },
  ],
  retrievedAt: '2026-08-01T00:00:00.000Z',
}

const horizon = { through: yearMonth(2027, 6) }

describe('extend', () => {
  it('never rewrites a published fixing', () => {
    // A reconstructed history has to stay factual even while the same series is being
    // used to project forward.
    const extended = extend(published, { kind: 'SHOCK', deltaBps: 300 }, horizon)

    expect(rateAt(extended, yearMonth(2025, 1))).toBeCloseTo(0.028, 12)
    expect(rateAt(extended, yearMonth(2026, 7))).toBeCloseTo(0.0285, 12)
  })

  it('HOLD_LAST continues the last fixing', () => {
    const extended = extend(published, { kind: 'HOLD_LAST' }, horizon)

    expect(lastPeriod(extended)).toBe(yearMonth(2027, 6))
    expect(rateAt(extended, yearMonth(2026, 12))).toBeCloseTo(0.0285, 12)
    expect(rateAt(extended, yearMonth(2027, 6))).toBeCloseTo(0.0285, 12)
  })

  it('SHOCK shifts the last fixing by the given basis points', () => {
    const up = extend(published, { kind: 'SHOCK', deltaBps: 200 }, horizon)
    const down = extend(published, { kind: 'SHOCK', deltaBps: -100 }, horizon)

    expect(rateAt(up, yearMonth(2027, 1))).toBeCloseTo(0.0485, 12)
    expect(rateAt(down, yearMonth(2027, 1))).toBeCloseTo(0.0185, 12)
  })

  it('FIXED replaces the projection with a flat rate', () => {
    const extended = extend(published, { kind: 'FIXED', rate: 0.04 }, horizon)
    expect(rateAt(extended, yearMonth(2027, 1))).toBeCloseTo(0.04, 12)
    expect(rateAt(extended, yearMonth(2026, 7))).toBeCloseTo(0.0285, 12)
  })

  it('CURVE follows an explicit path and holds its last point beyond it', () => {
    const extended = extend(
      published,
      {
        kind: 'CURVE',
        points: [
          { period: yearMonth(2026, 10), rate: 0.03 },
          { period: yearMonth(2027, 1), rate: 0.025 },
        ],
      },
      horizon,
    )

    // Before the curve begins, the published fixing still applies.
    expect(rateAt(extended, yearMonth(2026, 8))).toBeCloseTo(0.0285, 12)
    expect(rateAt(extended, yearMonth(2026, 11))).toBeCloseTo(0.03, 12)
    expect(rateAt(extended, yearMonth(2027, 3))).toBeCloseTo(0.025, 12)
    // Past the curve's end it holds, rather than reverting to the published fixing.
    expect(rateAt(extended, yearMonth(2027, 6))).toBeCloseTo(0.025, 12)
  })

  it('leaves a series that already reaches the horizon alone', () => {
    const extended = extend(published, { kind: 'HOLD_LAST' }, { through: yearMonth(2026, 1) })
    expect(extended.points).toEqual(published.points)
  })

  it('covers every month up to the horizon, with no gaps', () => {
    const extended = extend(published, { kind: 'HOLD_LAST' }, horizon)
    const projected = extended.points.filter((point) => point.period > yearMonth(2026, 7))
    expect(projected).toHaveLength(11) // Aug 2026 through Jun 2027
  })

  describe('with no published data at all', () => {
    const empty: RateSeries = { providerId: 'test', tenor: '12M', points: [], retrievedAt: null }

    it('cannot anchor HOLD_LAST or SHOCK, and says so by staying empty', () => {
      // There is nothing to hold or shift. Fabricating a number here would be the engine
      // inventing a rate by proxy, which ADR 0001 exists to prevent.
      expect(extend(empty, { kind: 'HOLD_LAST' }, horizon).points).toEqual([])
      expect(extend(empty, { kind: 'SHOCK', deltaBps: 100 }, horizon).points).toEqual([])
    })

    it('can still apply an assumption that names its own rate', () => {
      const fixed = extend(empty, { kind: 'FIXED', rate: 0.04 }, horizon)
      expect(rateAt(fixed, yearMonth(2027, 6))).toBeCloseTo(0.04, 12)

      const curve = extend(
        empty,
        { kind: 'CURVE', points: [{ period: yearMonth(2026, 1), rate: 0.02 }] },
        horizon,
      )
      expect(rateAt(curve, yearMonth(2026, 6))).toBeCloseTo(0.02, 12)
    })
  })
})

describe('sensitivitySeries', () => {
  it('produces one variant per shock, tagged with its shift', () => {
    const variants = sensitivitySeries(published, horizon)

    expect(variants.map((variant) => variant.deltaBps)).toEqual([...SENSITIVITY_SHOCKS_BPS])
    expect(rateAt(variants[0]!.series, yearMonth(2027, 1))).toBeCloseTo(0.0185, 12)
    expect(rateAt(variants[1]!.series, yearMonth(2027, 1))).toBeCloseTo(0.0285, 12)
    expect(rateAt(variants.at(-1)!.series, yearMonth(2027, 1))).toBeCloseTo(0.0585, 12)
  })

  it('weights the fan toward rate rises, which is the direction that hurts', () => {
    const shocks = [...SENSITIVITY_SHOCKS_BPS]
    expect(shocks).toContain(0)
    expect(shocks.filter((shock) => shock > 0).length).toBeGreaterThan(
      shocks.filter((shock) => shock < 0).length,
    )
  })

  it('accepts a custom set of shocks', () => {
    const variants = sensitivitySeries(published, horizon, [0, 50])
    expect(variants).toHaveLength(2)
    expect(rateAt(variants[1]!.series, yearMonth(2027, 1))).toBeCloseTo(0.0335, 12)
  })
})
