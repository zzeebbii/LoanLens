import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  abs,
  add,
  allocate,
  compare,
  divideByInteger,
  fromMajorUnits,
  isZero,
  max,
  min,
  money,
  multiplyByInteger,
  multiplyByRate,
  negate,
  parseMoney,
  subtract,
  sum,
  toCents,
  toMajorUnits,
  ZERO,
} from '@/domain/money'

/** Arbitrary amounts in a range that covers realistic loans with room to spare. */
const anyMoney = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }).map((cents) => money(cents))
const anyNonNegativeMoney = fc.bigInt({ min: 0n, max: 10n ** 12n }).map((cents) => money(cents))

describe('construction', () => {
  it('accepts integer cents as bigint or number', () => {
    expect(toCents(money(1234n))).toBe(1234n)
    expect(toCents(money(1234))).toBe(1234n)
  })

  it('rejects a non-integer number of cents, rather than silently truncating', () => {
    expect(() => money(12.5)).toThrow(RangeError)
  })

  it('converts from major units', () => {
    expect(toCents(fromMajorUnits(250_000))).toBe(25_000_000n)
    expect(toCents(fromMajorUnits(812.44))).toBe(81_244n)
    expect(toCents(fromMajorUnits(-0.01))).toBe(-1n)
  })

  it('round-trips through major units for representable amounts', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (cents) => {
        expect(toCents(fromMajorUnits(toMajorUnits(money(cents))))).toBe(cents)
      }),
    )
  })
})

describe('parseMoney', () => {
  it('parses decimal input without going through a float', () => {
    expect(toCents(parseMoney('812.44')!)).toBe(81_244n)
    expect(toCents(parseMoney('250000')!)).toBe(25_000_000n)
    expect(toCents(parseMoney('0.1')!)).toBe(10n)
    expect(toCents(parseMoney('-19.99')!)).toBe(-1999n)
    expect(toCents(parseMoney('+5.05')!)).toBe(505n)
  })

  it('accepts a comma decimal separator, as most euro-area locales write it', () => {
    expect(toCents(parseMoney('812,44')!)).toBe(81_244n)
  })

  it('rounds excess precision half-up rather than truncating', () => {
    expect(toCents(parseMoney('1.005')!)).toBe(101n)
    expect(toCents(parseMoney('1.004')!)).toBe(100n)
    // The classic float trap: 1.005 * 100 is 100.49999999999999 as a double.
    expect(toCents(parseMoney('1.005')!)).not.toBe(100n)
  })

  it('returns null for input that is not a number', () => {
    for (const input of ['', '  ', 'abc', '1.2.3', '1,2,3', '--1', '1e5']) {
      expect(parseMoney(input)).toBeNull()
    }
  })
})

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(toCents(add(money(1n), money(2n)))).toBe(3n)
    expect(toCents(subtract(money(1n), money(2n)))).toBe(-1n)
  })

  it('is associative and commutative under addition', () => {
    fc.assert(
      fc.property(anyMoney, anyMoney, anyMoney, (a, b, c) => {
        expect(add(add(a, b), c)).toBe(add(a, add(b, c)))
        expect(add(a, b)).toBe(add(b, a))
      }),
    )
  })

  it('has zero as the additive identity and negate as the inverse', () => {
    fc.assert(
      fc.property(anyMoney, (a) => {
        expect(add(a, ZERO)).toBe(a)
        expect(isZero(add(a, negate(a)))).toBe(true)
        expect(abs(a)).toBe(a < ZERO ? negate(a) : a)
      }),
    )
  })

  it('sums an empty collection to zero', () => {
    expect(sum([])).toBe(ZERO)
    expect(toCents(sum([money(1n), money(2n), money(3n)]))).toBe(6n)
  })

  it('multiplies by an integer count', () => {
    expect(toCents(multiplyByInteger(money(81_244n), 12))).toBe(974_928n)
    expect(toCents(multiplyByInteger(money(81_244n), 0))).toBe(0n)
  })
})

describe('multiplyByRate', () => {
  it('computes monthly interest to the cent', () => {
    // 250,000.00 at 3.4% nominal annual, one twelfth of a year.
    const balance = fromMajorUnits(250_000)
    expect(toCents(multiplyByRate(balance, 0.034 / 12))).toBe(70_833n)
  })

  it('rounds half-up by default', () => {
    // 100.00 * 0.005 = 0.50 exactly; 100.00 * 0.0050001 rounds up.
    expect(toCents(multiplyByRate(fromMajorUnits(1), 0.005))).toBe(1n)
    expect(toCents(multiplyByRate(fromMajorUnits(1), 0.004_9))).toBe(0n)
  })

  it('honours the requested rounding mode', () => {
    const amount = money(1000n)
    expect(toCents(multiplyByRate(amount, 0.0025, 'DOWN'))).toBe(2n)
    expect(toCents(multiplyByRate(amount, 0.0025, 'UP'))).toBe(3n)
    expect(toCents(multiplyByRate(amount, 0.0025, 'HALF_UP'))).toBe(3n)
    expect(toCents(multiplyByRate(amount, 0.0025, 'HALF_EVEN'))).toBe(2n)
  })

  it('rounds away from zero symmetrically for negative amounts', () => {
    expect(toCents(multiplyByRate(money(-1000n), 0.0025, 'HALF_UP'))).toBe(-3n)
    expect(toCents(multiplyByRate(money(-1000n), 0.0025, 'DOWN'))).toBe(-2n)
  })

  it('is zero at a zero rate and identity at a rate of one', () => {
    fc.assert(
      fc.property(anyMoney, (a) => {
        expect(isZero(multiplyByRate(a, 0))).toBe(true)
        expect(multiplyByRate(a, 1)).toBe(a)
      }),
    )
  })

  it('never drifts more than a cent from the exact product', () => {
    fc.assert(
      fc.property(
        anyNonNegativeMoney,
        fc.double({ min: 0, max: 0.5, noNaN: true, noDefaultInfinity: true }),
        (amount, rate) => {
          const exact = Number(toCents(amount)) * rate
          const actual = Number(toCents(multiplyByRate(amount, rate)))
          expect(Math.abs(actual - exact)).toBeLessThanOrEqual(1)
        },
      ),
    )
  })

  it('rejects a rate that is not a finite, sanely-scaled number', () => {
    expect(() => multiplyByRate(money(1n), Number.NaN)).toThrow(RangeError)
    expect(() => multiplyByRate(money(1n), Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => multiplyByRate(money(1n), 1e6)).toThrow(RangeError)
  })
})

describe('divideByInteger', () => {
  it('divides with the requested rounding', () => {
    expect(toCents(divideByInteger(money(100n), 3))).toBe(33n)
    expect(toCents(divideByInteger(money(100n), 3, 'UP'))).toBe(34n)
    expect(toCents(divideByInteger(money(50n), 4, 'HALF_EVEN'))).toBe(12n)
  })

  it('refuses to divide by zero', () => {
    expect(() => divideByInteger(money(100n), 0)).toThrow(RangeError)
  })
})

describe('allocate', () => {
  it('splits without losing or inventing cents', () => {
    const parts = allocate(money(100n), [1, 1, 1])
    expect(parts.map(toCents)).toEqual([34n, 33n, 33n])
    expect(sum(parts)).toBe(money(100n))
  })

  it('respects the weighting', () => {
    const parts = allocate(fromMajorUnits(100), [70, 30])
    expect(parts.map(toCents)).toEqual([7000n, 3000n])
  })

  it('always conserves the total, for any amount and weights', () => {
    fc.assert(
      fc.property(
        anyMoney,
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 12 }),
        (amount, weights) => {
          fc.pre(weights.some((weight) => weight > 0))
          const parts = allocate(amount, weights)
          expect(parts).toHaveLength(weights.length)
          expect(sum(parts)).toBe(amount)
        },
      ),
    )
  })

  it('rejects weights that cannot define a split', () => {
    expect(() => allocate(money(100n), [])).toThrow(RangeError)
    expect(() => allocate(money(100n), [0, 0])).toThrow(RangeError)
    expect(() => allocate(money(100n), [1, -1])).toThrow(RangeError)
  })
})

describe('comparison', () => {
  it('orders amounts', () => {
    expect(compare(money(1n), money(2n))).toBeLessThan(0)
    expect(compare(money(2n), money(1n))).toBeGreaterThan(0)
    expect(compare(money(1n), money(1n))).toBe(0)
    expect(min(money(1n), money(2n))).toBe(money(1n))
    expect(max(money(1n), money(2n))).toBe(money(2n))
  })

  it('sorts consistently with the underlying integers', () => {
    fc.assert(
      fc.property(fc.array(anyMoney, { maxLength: 20 }), (amounts) => {
        const sorted = amounts.toSorted(compare)
        for (let index = 1; index < sorted.length; index += 1) {
          expect(toCents(sorted[index]!) >= toCents(sorted[index - 1]!)).toBe(true)
        }
      }),
    )
  })
})
