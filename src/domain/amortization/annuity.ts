import type { AmortizationStrategy, InstalmentInput } from '@/domain/amortization/strategy'

import { divideByInteger, multiplyByRate } from '@/domain/money'

/**
 * Annuity repayment: a level instalment that fully amortises the balance over the
 * remaining term.
 *
 *     P = L · i / (1 − (1 + i)^−n)
 *
 * where L is the balance, i the periodic rate and n the periods remaining.
 *
 * On a floating-rate loan the instalment is level only *between* rate resets. At each
 * reset the lender recomputes P from the balance then outstanding, the new rate, and
 * the periods still remaining — so the payment moves and the payoff date does not.
 * That recomputation happens in `schedule.ts`; this function only answers "how big".
 */
export const annuityStrategy: AmortizationStrategy = {
  type: 'ANNUITY',

  instalment({ balance, periodicRate, remainingPeriods, rounding }: InstalmentInput) {
    if (!Number.isFinite(periodicRate)) {
      throw new RangeError(`Periodic rate must be a finite number, received ${periodicRate}.`)
    }
    if (!Number.isInteger(remainingPeriods) || remainingPeriods < 1) {
      throw new RangeError(
        `Remaining periods must be a positive integer, received ${remainingPeriods}.`,
      )
    }

    // At a zero rate the annuity formula divides by zero; the instalment is simply the
    // balance spread evenly. Rounded up so the final payment is never larger than the
    // rest — a loan that ends with a balloon would be a surprising kind of "level".
    //
    // `1 + periodicRate === 1` catches the same degeneracy one step earlier: for a rate
    // small enough to vanish when added to one, `(1 + i)^-n` is exactly 1, the
    // denominator is exactly 0, and the formula yields Infinity. Testing the rate
    // against zero alone misses it, which a property test found by generating a
    // subnormal rate.
    if (periodicRate === 0 || 1 + periodicRate === 1) {
      return divideByInteger(balance, remainingPeriods, 'UP')
    }

    // The denominator is computed as `-expm1(-n · log1p(i))` rather than the literal
    // `1 - (1 + i)^-n`.
    //
    // The two are algebraically identical, but the literal form loses catastrophically
    // for small rates. At i = 1.3e-15 over 121 periods, `(1 + i)^-n` is 0.999999999999839
    // and subtracting it from 1 discards all but about three significant digits — which
    // came out roughly half the true value, halved the instalment, and left the loan
    // still unpaid at twice its term. `log1p` and `expm1` are built to keep full
    // precision near zero, so this form is accurate across the whole range of rates.
    //
    // A negative periodic rate is possible in principle (a deeply negative reference with
    // a thin margin); the formula stays well-defined, so it is allowed through.
    const annuityFactor = -periodicRate / Math.expm1(-remainingPeriods * Math.log1p(periodicRate))

    return multiplyByRate(balance, annuityFactor, rounding)
  },
}
