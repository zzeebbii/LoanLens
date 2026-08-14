import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { annuityStrategy } from '@/domain/amortization/annuity'
import { strategyFor } from '@/domain/amortization/index'
import { fromMajorUnits, isPositive, isZero, toCents } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { fixedRateLoan, noRates } from '@/domain/testing/fixtures'

const instalment = (balanceMajor: number, periodicRate: number, remainingPeriods: number): bigint =>
  toCents(
    annuityStrategy.instalment({
      balance: fromMajorUnits(balanceMajor),
      periodicRate,
      remainingPeriods,
      rounding: 'HALF_UP',
    }),
  )

describe('annuityStrategy', () => {
  it('matches the closed-form annuity formula', () => {
    // 250,000 at 3.4%/12 over 300 periods, verified independently with Python's decimal.
    expect(instalment(250_000, 0.034 / 12, 300)).toBe(123_819n)
  })

  it('spreads the balance evenly at a zero rate', () => {
    expect(instalment(1200, 0, 12)).toBe(10_000n)
  })

  it('rounds a zero-rate instalment up so the loan never ends in a balloon', () => {
    // 100.00 over 3 periods is 33.33 recurring; rounding down would leave a cent
    // outstanding after the final payment.
    expect(instalment(100, 0, 3)).toBe(3334n)
  })

  it('treats a rate too small to register as zero', () => {
    // Regression, found by a property test: for a subnormal rate `(1 + i)` is exactly 1,
    // so `(1 + i)^-n` is 1, the denominator is 0, and the formula returns Infinity.
    const subnormal = 5e-324
    expect(1 + subnormal).toBe(1)
    expect(instalment(1200, subnormal, 12)).toBe(10_000n)
  })

  it('settles the whole balance plus one period of interest in a single period', () => {
    // With n = 1 the formula collapses to L·(1 + i), which is the balance and one
    // period's interest — not the balance alone.
    expect(instalment(1000, 0.01, 1)).toBe(101_000n)
  })

  it('produces a smaller instalment over a longer term', () => {
    expect(instalment(250_000, 0.034 / 12, 360) < instalment(250_000, 0.034 / 12, 240)).toBe(true)
  })

  it('produces a larger instalment at a higher rate', () => {
    expect(instalment(250_000, 0.05 / 12, 300) > instalment(250_000, 0.034 / 12, 300)).toBe(true)
  })

  it('handles a negative periodic rate without blowing up', () => {
    // A deeply negative reference with a thin margin. The formula stays well-defined and
    // the instalment falls below a straight even split, so the maths is left to work.
    const result = instalment(120_000, -0.001, 120)
    expect(result).toBeLessThan(100_000n)
    expect(result).toBeGreaterThan(0n)
  })

  it('always yields a positive instalment for a positive balance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.double({ min: 0, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 600 }),
        (balanceMajor, periodicRate, periods) => {
          const result = annuityStrategy.instalment({
            balance: fromMajorUnits(balanceMajor),
            periodicRate,
            remainingPeriods: periods,
            rounding: 'HALF_UP',
          })
          expect(isPositive(result)).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('stays accurate at rates small enough to break the literal formula', () => {
    // Regression, found by a property test. Computing the denominator as
    // `1 - (1 + i)^-n` at i = 1.33e-15 loses all but ~3 significant digits, which
    // produced an instalment roughly half the correct size — the loan was still unpaid
    // at twice its term. The stable form must land on the even split, 1/n of the
    // balance, because a rate this small is economically zero.
    const tinyRate = 1.332_267_629_550_188e-15
    expect(1 + tinyRate).not.toBe(1) // slips past the zero-rate guard
    // 100,000 cents over 121 periods is 826.4 recurring, rounded half-up. (The
    // exactly-zero-rate path rounds up instead, to 827, so that a zero-interest loan
    // never needs an extra period.)
    expect(instalment(1000, tinyRate, 121)).toBe(826n)
    expect(instalment(1210, tinyRate, 121)).toBe(1000n)
  })

  it('amortises fully at a near-zero rate, within the original term', () => {
    const rows = replay({
      loan: fixedRateLoan({
        principal: fromMajorUnits(1000),
        termMonths: 121,
        annualRate: 1.332_267_629_550_188e-13,
      }),
      referenceRateAt: noRates,
    })
    expect(rows.length).toBeLessThanOrEqual(122)
    expect(isZero(rows.at(-1)!.closingBalance)).toBe(true)
  })

  it('rejects inputs that cannot describe a schedule', () => {
    expect(() => instalment(1000, Number.NaN, 12)).toThrow(RangeError)
    expect(() => instalment(1000, 0.01, 0)).toThrow(RangeError)
    expect(() => instalment(1000, 0.01, -5)).toThrow(RangeError)
    expect(() => instalment(1000, 0.01, 12.5)).toThrow(RangeError)
  })
})

describe('strategyFor', () => {
  it('resolves the annuity strategy', () => {
    expect(strategyFor('ANNUITY')).toBe(annuityStrategy)
    expect(strategyFor('ANNUITY').type).toBe('ANNUITY')
  })
})
