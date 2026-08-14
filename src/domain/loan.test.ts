import type { RateBasis } from '@/domain/loan'

import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { bpsToRate, combineCaps, effectiveRate, rateToBps, roundRate } from '@/domain/loan'

function floating(overrides: Partial<Extract<RateBasis, { kind: 'FLOATING' }>> = {}) {
  return {
    kind: 'FLOATING' as const,
    reference: { providerId: 'ecb', tenor: '12M' as const },
    marginBps: 55,
    referenceFloor: 0,
    cap: null,
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
    expect(effectiveRate(floating(), 0.028_55).rate).toBeCloseTo(0.034_05, 12)
  })

  it('applies the floor to the reference before the margin', () => {
    // The order matters. Flooring the *total* at 0 would have left a -0.5% reference
    // borrower paying 0% rather than the 0.55% margin they actually owed, which is the
    // opposite of what euro-area agreements did through the negative-rate years.
    expect(effectiveRate(floating({ referenceFloor: 0 }), -0.005).rate).toBeCloseTo(0.0055, 12)
    expect(effectiveRate(floating({ referenceFloor: null }), -0.005).rate).toBeCloseTo(0.0005, 12)
  })

  it('honours a non-zero floor', () => {
    expect(effectiveRate(floating({ referenceFloor: 0.01 }), 0.002).rate).toBeCloseTo(0.0155, 12)
    expect(effectiveRate(floating({ referenceFloor: 0.01 }), 0.03).rate).toBeCloseTo(0.0355, 12)
  })

  it('rounds the combined rate when the agreement requires it', () => {
    const basis = floating({ rateRounding: { decimals: 3, mode: 'HALF_UP' } })
    expect(effectiveRate(basis, 0.028_557).rate).toBeCloseTo(0.034_06, 12)
  })

  it('can produce a negative applied rate when nothing floors it', () => {
    expect(
      effectiveRate(floating({ referenceFloor: null, marginBps: 10 }), -0.005).rate,
    ).toBeCloseTo(-0.004, 12)
  })
})

describe('rate caps', () => {
  it('holds the reference at the ceiling and charges the premium', () => {
    // EURIBOR at 4.2%, capped at 3%, premium 0.35pp, margin 0.55pp.
    const result = effectiveRate(floating(), 0.042, { ceiling: 0.03, premiumRate: 0.0035 })

    expect(result.clampedReference).toBeCloseTo(0.03, 12)
    expect(result.rate).toBeCloseTo(0.03 + 0.0055 + 0.0035, 12)
    expect(result.capped).toBe(true)
    expect(result.premiumRate).toBeCloseTo(0.0035, 12)
  })

  it('caps the reference, not the total rate', () => {
    // The distinction that decides whether the model matches a real agreement. Capping the
    // total at 3% would give 3%; capping the reference gives 3% + margin + premium.
    const result = effectiveRate(floating(), 0.042, { ceiling: 0.03, premiumRate: 0 })
    expect(result.rate).toBeCloseTo(0.0355, 12)
    expect(result.rate).not.toBeCloseTo(0.03, 6)
  })

  it('still charges the premium in the months the ceiling does not bind', () => {
    // The whole economics of a cap: you pay for it whether or not it pays out, which is why
    // "was it worth it" cannot be answered from a single month.
    const result = effectiveRate(floating(), 0.01, { ceiling: 0.03, premiumRate: 0.0035 })

    expect(result.capped).toBe(false)
    expect(result.clampedReference).toBeCloseTo(0.01, 12)
    expect(result.rate).toBeCloseTo(0.01 + 0.0055 + 0.0035, 12)
  })

  it('applies the floor before the ceiling', () => {
    // A fixing below the floor and a ceiling above it: the floor lifts, the ceiling is idle.
    const result = effectiveRate(floating({ referenceFloor: 0 }), -0.005, {
      ceiling: 0.03,
      premiumRate: 0,
    })
    expect(result.clampedReference).toBe(0)
    expect(result.capped).toBe(false)
  })

  it('lets the floor win over a ceiling beneath it, rather than undercutting it', () => {
    // A nonsensical agreement — `assertValidLoan` rejects it — but if one arrives, a
    // contractual minimum you owe should not be undercut by protection you bought.
    const result = effectiveRate(floating({ referenceFloor: 0.02 }), 0.01, {
      ceiling: 0.01,
      premiumRate: 0,
    })
    expect(result.clampedReference).toBeCloseTo(0.02, 12)
  })

  it('reports no cap and no premium when none is in force', () => {
    const result = effectiveRate(floating(), 0.042)

    expect(result.capped).toBe(false)
    expect(result.premiumRate).toBe(0)
    expect(result.rate).toBeCloseTo(0.0475, 12)
  })

  it('rounds the rate after the premium is added, not before', () => {
    const basis = floating({ rateRounding: { decimals: 2, mode: 'HALF_UP' } })
    // 1% + 0.55% + 0.351% = 1.901% -> 1.90%. Rounding before would give 1.55% + 0.351%.
    const result = effectiveRate(basis, 0.01, { ceiling: 0.05, premiumRate: 0.00351 })
    expect(result.rate).toBeCloseTo(0.019, 12)
  })
})

describe('combineCaps', () => {
  const cap = (ceiling: number, premiumBps: number) => ({
    ceiling,
    premiumBps,
    from: yearMonth(2026, 1),
    until: null,
  })

  it('is null when nothing is in force', () => {
    expect(combineCaps([])).toBeNull()
  })

  it('passes a single cap through', () => {
    expect(combineCaps([cap(0.03, 35)])).toEqual({ ceiling: 0.03, premiumRate: 0.0035 })
  })

  it('takes the tightest ceiling and adds the premiums', () => {
    // Two caps is not a normal arrangement, but a scenario laid over a loan that already has
    // one produces exactly that, and the rule has to be predictable.
    const combined = combineCaps([cap(0.04, 20), cap(0.025, 35)])

    expect(combined?.ceiling).toBeCloseTo(0.025, 12)
    expect(combined?.premiumRate).toBeCloseTo(0.0055, 12)
  })

  it('handles a promotional cap that costs nothing', () => {
    expect(combineCaps([cap(0.03, 0)])?.premiumRate).toBe(0)
  })
})
