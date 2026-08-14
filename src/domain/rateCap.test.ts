import type { LoanEvent } from '@/domain/scenario'

import { describe, expect, it } from 'vitest'

import { capEffect, totals } from '@/domain/analytics'
import { yearMonth } from '@/domain/dates'
import { isZero, subtract, sum, toCents, ZERO } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { floatingRateLoan, rateOf } from '@/domain/testing/fixtures'

/**
 * Interest rate caps.
 *
 * A cap is insurance: the bank holds the reference rate below a ceiling for a fixed term, and
 * charges a premium for the whole term whether or not the ceiling is ever reached. The
 * economics only resolve over the life of the cap, so these tests are mostly about the
 * interaction between "it cost this" and "it saved that" — a single month tells you nothing.
 *
 * The rate path below is the one that makes caps interesting: near zero in 2021-2022, then
 * the 2022-2023 spike that made every euro-area borrower think about this product.
 */
const RISING_RATES = rateOf({
  '2021-03': 0,
  '2022-03': 0.01,
  '2023-03': 0.038,
  '2024-03': 0.042,
  '2025-03': 0.035,
})

const CAP = {
  ceiling: 0.02,
  premiumBps: 35,
  from: yearMonth(2021, 3),
  until: yearMonth(2031, 3),
} as const

describe('a cap agreed as part of the loan', () => {
  it('holds the rate at the ceiling plus margin plus premium once rates exceed it', () => {
    const rows = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })
    const capped = rows.find((row) => row.period === yearMonth(2023, 6))!

    // Reference 3.8% is above the 2% ceiling, so: 2% + 0.55% margin + 0.35% premium.
    expect(capped.annualRate).toBeCloseTo(0.029, 10)
    expect(capped.flags).toContain('RATE_CAPPED')
    // The raw fixing is still reported, so it can be compared against a published figure.
    expect(capped.referenceRate).toBeCloseTo(0.038, 10)
    expect(capped.capCeiling).toBeCloseTo(0.02, 10)
  })

  it('charges the premium in months the ceiling never comes near', () => {
    const rows = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })
    const quiet = rows.find((row) => row.period === yearMonth(2021, 6))!

    // Reference 0%, floored at 0: 0% + 0.55% + 0.35%. The cap is idle and still charged for.
    expect(quiet.annualRate).toBeCloseTo(0.009, 10)
    expect(quiet.flags).not.toContain('RATE_CAPPED')
    expect(quiet.capPremium > ZERO).toBe(true)
  })

  it('costs more than no cap while rates stay low', () => {
    const withCap = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })
    const withoutCap = replay({ loan: floatingRateLoan(), referenceRateAt: RISING_RATES })

    const early = (rows: typeof withCap) =>
      sum(rows.filter((row) => row.period < yearMonth(2023, 3)).map((row) => row.interest))

    // Two years of premium bought nothing, because the ceiling was never approached.
    expect(early(withCap) > early(withoutCap)).toBe(true)
  })

  it('saves money over the full term when rates spike far enough', () => {
    const withCap = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })
    const withoutCap = replay({ loan: floatingRateLoan(), referenceRateAt: RISING_RATES })

    expect(totals(withCap).interest < totals(withoutCap).interest).toBe(true)
  })

  it('stops applying, and stops charging, when the cap expires', () => {
    const shortCap = {
      ...CAP,
      until: yearMonth(2023, 12),
    }
    const rows = replay({
      loan: floatingRateLoan({ cap: shortCap }),
      referenceRateAt: RISING_RATES,
    })

    const during = rows.find((row) => row.period === yearMonth(2023, 6))!
    const after = rows.find((row) => row.period === yearMonth(2024, 6))!

    expect(during.capCeiling).toBeCloseTo(0.02, 10)
    expect(during.capPremium > ZERO).toBe(true)

    // Expired: the reference floats free again and nothing is charged for protection.
    expect(after.capCeiling).toBeNull()
    expect(isZero(after.capPremium)).toBe(true)
    expect(after.annualRate).toBeCloseTo(0.042 + 0.0055, 10)
  })

  it('changes the rate the month a cap expires, not at the next reset', () => {
    // The cap ends in December, but this loan only resets each March. A rate frozen until
    // the next reset would keep charging for protection that had already lapsed.
    const rows = replay({
      loan: floatingRateLoan({ cap: { ...CAP, until: yearMonth(2023, 12) } }),
      referenceRateAt: RISING_RATES,
    })

    const lastCapped = rows.find((row) => row.period === yearMonth(2023, 12))!
    const firstFree = rows.find((row) => row.period === yearMonth(2024, 1))!

    expect(lastCapped.capCeiling).toBeCloseTo(0.02, 10)
    expect(firstFree.capCeiling).toBeNull()
    expect(firstFree.annualRate > lastCapped.annualRate).toBe(true)
    expect(firstFree.flags).toContain('PAYMENT_RECALCULATED')
  })

  it('starts applying the month the cap begins', () => {
    const rows = replay({
      loan: floatingRateLoan({ cap: { ...CAP, from: yearMonth(2023, 6) } }),
      referenceRateAt: RISING_RATES,
    })

    expect(rows.find((row) => row.period === yearMonth(2023, 5))!.capCeiling).toBeNull()
    expect(rows.find((row) => row.period === yearMonth(2023, 6))!.capCeiling).toBeCloseTo(0.02, 10)
  })

  it('still repays exactly the principal', () => {
    // The premium is interest, not capital. If it leaked into the capital column the loan
    // would appear to repay more than was borrowed.
    const loan = floatingRateLoan({ cap: CAP })
    const rows = replay({ loan, referenceRateAt: RISING_RATES })

    expect(sum(rows.map((row) => row.capital))).toBe(loan.principal)
    expect(isZero(rows.at(-1)!.closingBalance)).toBe(true)
  })

  it('counts the premium as part of the interest, never on top of it', () => {
    const rows = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })

    for (const row of rows) {
      expect(row.capPremium <= row.interest).toBe(true)
    }
  })

  it('charges no premium during a holiday that pays no interest', () => {
    const rows = replay({
      loan: floatingRateLoan({ cap: CAP }),
      referenceRateAt: RISING_RATES,
      events: [
        {
          kind: 'PAYMENT_HOLIDAY',
          from: yearMonth(2023, 1),
          until: yearMonth(2023, 6),
          interest: 'CAPITALISE',
        },
      ],
    })

    for (const row of rows.filter((candidate) => candidate.flags.includes('PAYMENT_HOLIDAY'))) {
      expect(isZero(row.capPremium)).toBe(true)
    }
  })

  it('rejects a ceiling below the floor rather than quietly resolving it', () => {
    expect(() =>
      replay({
        loan: floatingRateLoan({
          referenceFloor: 0.01,
          cap: { ...CAP, ceiling: 0.005 },
        }),
        referenceRateAt: RISING_RATES,
      }),
    ).toThrow(/could never take effect/)
  })

  it('rejects a negative premium and a cap that ends before it starts', () => {
    expect(() =>
      replay({
        loan: floatingRateLoan({ cap: { ...CAP, premiumBps: -10 } }),
        referenceRateAt: RISING_RATES,
      }),
    ).toThrow(RangeError)

    expect(() =>
      replay({
        loan: floatingRateLoan({
          cap: { ...CAP, from: yearMonth(2025, 1), until: yearMonth(2024, 1) },
        }),
        referenceRateAt: RISING_RATES,
      }),
    ).toThrow(/ends .* before it starts/)
  })

  it('ignores a cap on a fixed-rate loan, since there is no reference to cap', () => {
    // Guarding the nonsense case: a fixed rate cannot exceed a ceiling on an index it does
    // not track, so charging a premium would be a pure loss.
    const rows = replay({
      loan: { ...floatingRateLoan(), rateBasis: { kind: 'FIXED', annualRate: 0.05 } },
      referenceRateAt: RISING_RATES,
      events: [
        { kind: 'RATE_CAP', ceiling: 0.02, premiumBps: 35, from: yearMonth(2021, 3), until: null },
      ],
    })

    expect(rows[0]!.annualRate).toBeCloseTo(0.05, 10)
    expect(isZero(rows[0]!.capPremium)).toBe(true)
  })
})

describe('a cap offered as a scenario', () => {
  const offered: LoanEvent[] = [
    {
      kind: 'RATE_CAP',
      ceiling: 0.02,
      premiumBps: 35,
      from: yearMonth(2021, 3),
      until: yearMonth(2031, 3),
    },
  ]

  it('produces the same schedule as the equivalent agreed cap', () => {
    // The two forms exist for different questions — "I have one" and "should I take one" —
    // but must model identically, or the comparison would be measuring the difference
    // between two code paths rather than between two loans.
    const asEvent = replay({
      loan: floatingRateLoan(),
      referenceRateAt: RISING_RATES,
      events: offered,
    })
    const asTerm = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })

    expect(asEvent.map((row) => row.annualRate)).toEqual(asTerm.map((row) => row.annualRate))
    expect(totals(asEvent).interest).toBe(totals(asTerm).interest)
  })

  it('takes the tightest ceiling when layered over a loan that already has one', () => {
    const rows = replay({
      loan: floatingRateLoan({ cap: { ...CAP, ceiling: 0.03, premiumBps: 20 } }),
      referenceRateAt: RISING_RATES,
      events: offered,
    })
    const capped = rows.find((row) => row.period === yearMonth(2023, 6))!

    // Ceiling 2% (the lower of 3% and 2%), premiums 0.20% + 0.35% both charged.
    expect(capped.capCeiling).toBeCloseTo(0.02, 10)
    expect(capped.annualRate).toBeCloseTo(0.02 + 0.0055 + 0.002 + 0.0035, 10)
  })
})

describe('capEffect', () => {
  const capped = { loan: floatingRateLoan({ cap: CAP }), rateAt: RISING_RATES }

  it('separates what the ceiling saved from what the fee cost', () => {
    const effect = capEffect(capped)

    // The netted figure alone hides both halves of the decision.
    expect(effect.hasCap).toBe(true)
    expect(effect.premiumCost > ZERO).toBe(true)
    expect(effect.interestAvoided > ZERO).toBe(true)
    expect(effect.net).toBe(subtract(effect.interestAvoided, effect.premiumCost))
    expect(effect.worthwhile).toBe(true)
  })

  it('reconciles: net equals the observable difference in total interest', () => {
    const withoutCap = replay({ loan: floatingRateLoan(), referenceRateAt: RISING_RATES })
    const withCap = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })

    // The split has to add back up to something directly observable, or one of the two
    // halves is telling a story the schedules do not support.
    expect(capEffect(capped).net).toBe(
      subtract(totals(withoutCap).interest, totals(withCap).interest),
    )
  })

  it('attributes exactly nothing to a ceiling that never binds', () => {
    // The reason this needs three replays. Comparing uncapped against fully-capped charges
    // the premium's effect on the amortization path to the ceiling, which showed up as
    // several hundred euros of "avoided" interest on protection that did nothing at all.
    const flat = rateOf({ '2021-03': 0.005 })
    const effect = capEffect({ loan: floatingRateLoan({ cap: CAP }), rateAt: flat })

    expect(isZero(effect.interestAvoided)).toBe(true)
    expect(effect.premiumCost > ZERO).toBe(true)
    expect(effect.worthwhile).toBe(false)
    expect(toCents(effect.net) < 0n).toBe(true)
  })

  it('charges the premium its knock-on, not just its face value', () => {
    // A premium raises the rate, which changes the whole amortization path, so the all-in
    // cost differs from the sum of the charges on the rows.
    const rows = replay({ loan: floatingRateLoan({ cap: CAP }), referenceRateAt: RISING_RATES })
    const charged = sum(rows.map((row) => row.capPremium))

    expect(capEffect(capped).premiumCost).not.toBe(charged)
  })

  it('reports nothing for a loan with no cap anywhere', () => {
    const effect = capEffect({ loan: floatingRateLoan(), rateAt: RISING_RATES })

    expect(effect.hasCap).toBe(false)
    expect(isZero(effect.premiumCost)).toBe(true)
    expect(isZero(effect.interestAvoided)).toBe(true)
    expect(isZero(effect.net)).toBe(true)
    expect(effect.worthwhile).toBe(false)
  })

  it('measures a cap offered as a scenario the same way', () => {
    const asEvent = capEffect({
      loan: floatingRateLoan(),
      rateAt: RISING_RATES,
      events: [
        {
          kind: 'RATE_CAP',
          ceiling: 0.02,
          premiumBps: 35,
          from: yearMonth(2021, 3),
          until: yearMonth(2031, 3),
        },
      ],
    })

    expect(asEvent.hasCap).toBe(true)
    expect(asEvent.net).toBe(capEffect(capped).net)
  })
})
