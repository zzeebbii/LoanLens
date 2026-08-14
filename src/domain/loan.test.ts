import type { RateBasis } from '@/domain/loan'

import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { bpsToRate, effectiveRate, rateToBps, roundRate } from '@/domain/loan'

function floating(overrides: Partial<Extract<RateBasis, { kind: 'FLOATING' }>> = {}) {
  return {
    kind: 'FLOATING' as const,
    reference: { providerId: 'ecb', tenor: '12M' as const },
    marginBps: 55,
    referenceFloor: 0,
    resetMonths: 12,
    firstResetPeriod: yearMonth(2021, 3),
    rateRounding: null,
    ...overrides,
  }
}

describe('basis points', () => {
  it('converts in both directions', () => {
    expect(bpsToRate(55)).toBeCloseTo(0.0055, 12)
    expect(bpsToRate(0)).toBe(0)
    expect(rateToBps(0.0055)).toBeCloseTo(55, 9)
  })
})

describe('roundRate', () => {
  // Expressed on the percentage, because that is how a loan agreement states the rule:
  // "the applied rate is rounded to three decimal places".
  it('rounds half-up on the percentage', () => {
    expect(roundRate(0.034_057, { decimals: 2, mode: 'HALF_UP' })).toBeCloseTo(0.0341, 12)
    expect(roundRate(0.034_044, { decimals: 2, mode: 'HALF_UP' })).toBeCloseTo(0.034, 12)
    expect(roundRate(0.028_555, { decimals: 3, mode: 'HALF_UP' })).toBeCloseTo(0.028_56, 12)
  })

  it('supports the other modes', () => {
    expect(roundRate(0.034_057, { decimals: 2, mode: 'DOWN' })).toBeCloseTo(0.034, 12)
    expect(roundRate(0.034_011, { decimals: 2, mode: 'UP' })).toBeCloseTo(0.0341, 12)
  })

  it('breaks a decimal tie to the even neighbour under HALF_EVEN', () => {
    // 3.445% and 3.455% are exact ties at two decimals. Scaling them to 344.5 and 345.5
    // lands a hair either side of .5 in binary, so this only holds because the tie test
    // is tolerant rather than an exact `=== 0.5`.
    expect(roundRate(0.034_45, { decimals: 2, mode: 'HALF_EVEN' })).toBeCloseTo(0.0344, 12)
    expect(roundRate(0.034_55, { decimals: 2, mode: 'HALF_EVEN' })).toBeCloseTo(0.0346, 12)
    // HALF_UP takes both ties upward.
    expect(roundRate(0.034_45, { decimals: 2, mode: 'HALF_UP' })).toBeCloseTo(0.0345, 12)
    expect(roundRate(0.034_55, { decimals: 2, mode: 'HALF_UP' })).toBeCloseTo(0.0346, 12)
  })

  it('leaves an already-exact rate alone, even under UP', () => {
    // Regression: `0.034 * 100 * 100` is 340.00000000000006, so an unguarded UP mode
    // added a basis point to every rate that needed no rounding at all.
    expect(roundRate(0.034, { decimals: 2, mode: 'UP' })).toBeCloseTo(0.034, 12)
    expect(roundRate(0.034, { decimals: 2, mode: 'DOWN' })).toBeCloseTo(0.034, 12)
    expect(roundRate(0.028_55, { decimals: 3, mode: 'UP' })).toBeCloseTo(0.028_55, 12)
    expect(roundRate(0.07, { decimals: 2, mode: 'UP' })).toBeCloseTo(0.07, 12)
    expect(roundRate(-0.034, { decimals: 2, mode: 'UP' })).toBeCloseTo(-0.034, 12)
  })

  it('rounds negative rates away from zero under UP and toward zero under DOWN', () => {
    expect(roundRate(-0.034_057, { decimals: 2, mode: 'DOWN' })).toBeCloseTo(-0.034, 12)
    expect(roundRate(-0.034_011, { decimals: 2, mode: 'UP' })).toBeCloseTo(-0.0341, 12)
    expect(roundRate(-0.034_057, { decimals: 2, mode: 'HALF_UP' })).toBeCloseTo(-0.0341, 12)
  })

  it('handles zero decimals', () => {
    expect(roundRate(0.034_6, { decimals: 0, mode: 'HALF_UP' })).toBeCloseTo(0.03, 12)
    expect(roundRate(0.036, { decimals: 0, mode: 'HALF_UP' })).toBeCloseTo(0.04, 12)
  })
})

describe('effectiveRate', () => {
  it('adds the margin to the reference', () => {
    expect(effectiveRate(floating(), 0.028_55)).toBeCloseTo(0.034_05, 12)
  })

  it('applies the floor to the reference before the margin', () => {
    // The order matters. Flooring the *total* at 0 would have left a -0.5% reference
    // borrower paying 0% rather than the 0.55% margin they actually owed, which is the
    // opposite of what euro-area agreements did through the negative-rate years.
    expect(effectiveRate(floating({ referenceFloor: 0 }), -0.005)).toBeCloseTo(0.0055, 12)
    expect(effectiveRate(floating({ referenceFloor: null }), -0.005)).toBeCloseTo(0.0005, 12)
  })

  it('honours a non-zero floor', () => {
    expect(effectiveRate(floating({ referenceFloor: 0.01 }), 0.002)).toBeCloseTo(0.0155, 12)
    expect(effectiveRate(floating({ referenceFloor: 0.01 }), 0.03)).toBeCloseTo(0.0355, 12)
  })

  it('rounds the combined rate when the agreement requires it', () => {
    const basis = floating({ rateRounding: { decimals: 3, mode: 'HALF_UP' } })
    expect(effectiveRate(basis, 0.028_557)).toBeCloseTo(0.034_06, 12)
  })

  it('can produce a negative applied rate when nothing floors it', () => {
    expect(effectiveRate(floating({ referenceFloor: null, marginBps: 10 }), -0.005)).toBeCloseTo(
      -0.004,
      12,
    )
  })
})
