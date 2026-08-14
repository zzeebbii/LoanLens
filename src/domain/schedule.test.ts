import type { LoanEvent } from '@/domain/scenario'
import type { PaymentRow } from '@/domain/schedule'

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { localDate, yearMonth } from '@/domain/dates'
import { add, fromMajorUnits, isZero, money, subtract, sum, toCents, ZERO } from '@/domain/money'
import { MissingRateError, NonAmortizingLoanError, replay } from '@/domain/schedule'
import { fixedRateLoan, floatingRateLoan, noRates, rateOf } from '@/domain/testing/fixtures'

/**
 * The reference schedule below was produced independently, with Python's `decimal`
 * module, before the TypeScript engine existed:
 *
 *   250,000.00 at 3.4% nominal annual, 300 monthly instalments, MONTHLY_NOMINAL,
 *   interest and instalment both rounded half-up to the cent.
 *
 * If the engine ever disagrees with these numbers, the engine is what changed.
 */
const REFERENCE = {
  instalmentCents: 123_819n,
  firstRow: { interest: 70_833n, capital: 52_986n, closing: 24_947_014n },
  secondRow: { interest: 70_683n, capital: 53_136n, closing: 24_893_878n },
  periods: 301,
  finalRowPaid: 49n,
  totalInterestCents: 12_145_749n,
  totalPaidCents: 37_145_749n,
} as const

function totalInterest(rows: readonly PaymentRow[]) {
  return sum(rows.map((row) => row.interest))
}

function totalCapital(rows: readonly PaymentRow[]) {
  return sum(rows.map((row) => row.capital))
}

describe('replay — fixed rate, against an independently computed schedule', () => {
  const rows = replay({ loan: fixedRateLoan(), referenceRateAt: noRates })

  it('sizes the annuity instalment correctly', () => {
    expect(toCents(rows[0]!.scheduledInstalment)).toBe(REFERENCE.instalmentCents)
  })

  it('splits the first two instalments to the cent', () => {
    expect(toCents(rows[0]!.interest)).toBe(REFERENCE.firstRow.interest)
    expect(toCents(rows[0]!.capital)).toBe(REFERENCE.firstRow.capital)
    expect(toCents(rows[0]!.closingBalance)).toBe(REFERENCE.firstRow.closing)

    expect(toCents(rows[1]!.interest)).toBe(REFERENCE.secondRow.interest)
    expect(toCents(rows[1]!.capital)).toBe(REFERENCE.secondRow.capital)
    expect(toCents(rows[1]!.closingBalance)).toBe(REFERENCE.secondRow.closing)
  })

  it('runs one period past the nominal term to settle the rounding residue', () => {
    // Rounding each instalment to the cent leaves a few cents outstanding. Real
    // lenders settle that with a final adjusting payment rather than by nudging every
    // earlier instalment, and so does this engine.
    expect(rows).toHaveLength(REFERENCE.periods)
    expect(toCents(rows.at(-1)!.totalPaid)).toBe(REFERENCE.finalRowPaid)
    expect(rows.at(-1)!.flags).toContain('BEYOND_ORIGINAL_TERM')
  })

  it('totals interest and payments to the cent', () => {
    expect(toCents(totalInterest(rows))).toBe(REFERENCE.totalInterestCents)
    expect(toCents(sum(rows.map((row) => row.totalPaid)))).toBe(REFERENCE.totalPaidCents)
  })

  it('shifts the split from interest toward capital, crossing over exactly once', () => {
    // The single most useful thing a borrower learns from an amortization table: early
    // instalments are mostly interest, and the crossover comes later than expected.
    // Month 57 of 300 here, independently confirmed against the Decimal reference.
    const first = rows[0]!
    const last = rows.at(-2)!

    expect(first.interest > first.capital).toBe(true)
    expect(last.capital > last.interest).toBe(true)

    const crossover = rows.slice(0, -1).find((row) => row.capital > row.interest)

    expect(crossover!.index).toBe(57)
    // Capital rises and interest falls monotonically, so it crosses once and stays.
    for (let position = 1; position < rows.length - 1; position += 1) {
      expect(rows[position]!.capital > rows[position - 1]!.capital).toBe(true)
      expect(rows[position]!.interest < rows[position - 1]!.interest).toBe(true)
    }
  })

  it('marks only the closing row as final', () => {
    expect(rows.filter((row) => row.flags.includes('FINAL_PAYMENT'))).toHaveLength(1)
    expect(rows.at(-1)!.flags).toContain('FINAL_PAYMENT')
  })

  it('dates the schedule from the first payment period, on the payment day', () => {
    expect(rows[0]!.period).toBe(yearMonth(2021, 3))
    expect(rows[0]!.dueDate).toEqual(localDate(2021, 3, 15))
    expect(rows[1]!.period).toBe(yearMonth(2021, 4))
  })
})

describe('replay — invariants', () => {
  /**
   * These are the assertions worth having: exact equalities that hold for every loan,
   * not spot checks of a single example. They are only expressible because money is
   * an exact integer type.
   */
  const anyLoan = fc.record({
    principalMajor: fc.integer({ min: 1_000, max: 2_000_000 }),
    termMonths: fc.integer({ min: 1, max: 480 }),
    annualRatePercent: fc.double({ min: 0, max: 15, noNaN: true, noDefaultInfinity: true }),
    paymentDay: fc.integer({ min: 1, max: 31 }),
    monthlyFeeCents: fc.integer({ min: 0, max: 1500 }),
  })

  it('repays exactly the principal, no more and no less', () => {
    fc.assert(
      fc.property(anyLoan, ({ principalMajor, termMonths, annualRatePercent, paymentDay }) => {
        const loan = fixedRateLoan({
          principal: fromMajorUnits(principalMajor),
          termMonths,
          annualRate: annualRatePercent / 100,
          paymentDay,
        })
        const rows = replay({ loan, referenceRateAt: noRates })

        expect(totalCapital(rows)).toBe(loan.principal)
        expect(isZero(rows.at(-1)!.closingBalance)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('never lets the balance rise, and closes each period where the next one opens', () => {
    fc.assert(
      fc.property(anyLoan, ({ principalMajor, termMonths, annualRatePercent }) => {
        const loan = fixedRateLoan({
          principal: fromMajorUnits(principalMajor),
          termMonths,
          annualRate: annualRatePercent / 100,
        })
        const rows = replay({ loan, referenceRateAt: noRates })

        expect(rows[0]!.openingBalance).toBe(loan.principal)

        for (const [position, row] of rows.entries()) {
          expect(row.closingBalance <= row.openingBalance).toBe(true)
          expect(row.closingBalance >= ZERO).toBe(true)
          if (position > 0) {
            expect(row.openingBalance).toBe(rows[position - 1]!.closingBalance)
          }
        }
      }),
      { numRuns: 200 },
    )
  })

  it('reconciles every row: closing = opening - capital - extra + capitalised', () => {
    fc.assert(
      fc.property(anyLoan, ({ principalMajor, termMonths, annualRatePercent, monthlyFeeCents }) => {
        const loan = fixedRateLoan({
          principal: fromMajorUnits(principalMajor),
          termMonths,
          annualRate: annualRatePercent / 100,
          monthlyServicing: money(BigInt(monthlyFeeCents)),
        })
        const rows = replay({ loan, referenceRateAt: noRates })

        for (const row of rows) {
          const expected = subtract(
            add(row.openingBalance, row.capitalisedInterest),
            add(row.capital, row.extraPayment),
          )
          expect(row.closingBalance).toBe(expected)
          expect(row.totalPaid).toBe(sum([row.interest, row.capital, row.extraPayment, row.fees]))
        }
      }),
      { numRuns: 100 },
    )
  })

  it('charges the servicing fee on every instalment and never folds it into capital', () => {
    const loan = fixedRateLoan({ monthlyServicing: fromMajorUnits(2.5) })
    const rows = replay({ loan, referenceRateAt: noRates })

    expect(sum(rows.map((row) => row.fees))).toBe(fromMajorUnits(2.5 * rows.length))
    expect(totalCapital(rows)).toBe(loan.principal)
  })

  it('handles a zero-interest loan by spreading the principal evenly', () => {
    const loan = fixedRateLoan({ principal: fromMajorUnits(1200), termMonths: 12, annualRate: 0 })
    const rows = replay({ loan, referenceRateAt: noRates })

    expect(rows).toHaveLength(12)
    expect(isZero(totalInterest(rows))).toBe(true)
    expect(toCents(rows[0]!.capital)).toBe(10_000n)
    expect(totalCapital(rows)).toBe(loan.principal)
  })

  it('handles a single-instalment loan', () => {
    const loan = fixedRateLoan({ principal: fromMajorUnits(1000), termMonths: 1 })
    const rows = replay({ loan, referenceRateAt: noRates })

    expect(rows).toHaveLength(1)
    expect(rows[0]!.capital).toBe(loan.principal)
    expect(isZero(rows[0]!.closingBalance)).toBe(true)
  })
})

describe('replay — floating rate and resets', () => {
  it('holds the rate between resets and refreshes it on the reset period', () => {
    // 12M-linked loan resetting each March. EURIBOR steps up sharply in year two,
    // which is roughly what happened to euro-area borrowers through 2022.
    const rates = rateOf({
      '2021-03': 0.005,
      '2022-03': 0.03,
      '2023-03': 0.038,
    })
    const rows = replay({ loan: floatingRateLoan(), referenceRateAt: rates })

    // Margin is 55bp, so the applied rate is reference + 0.0055.
    expect(rows[0]!.annualRate).toBeCloseTo(0.0105, 10)
    expect(rows[5]!.annualRate).toBeCloseTo(0.0105, 10)
    expect(rows[11]!.annualRate).toBeCloseTo(0.0105, 10)
    expect(rows[12]!.annualRate).toBeCloseTo(0.0355, 10)
    expect(rows[24]!.annualRate).toBeCloseTo(0.0435, 10)
  })

  it('recalculates the instalment at a reset and keeps the payoff date', () => {
    const rows = replay({
      loan: floatingRateLoan(),
      referenceRateAt: rateOf({ '2021-03': 0.005, '2022-03': 0.03, '2023-03': 0.038 }),
    })

    const beforeReset = rows[11]!
    const atReset = rows[12]!

    expect(atReset.flags).toContain('RATE_RESET')
    expect(atReset.flags).toContain('PAYMENT_RECALCULATED')
    expect(atReset.scheduledInstalment > beforeReset.scheduledInstalment).toBe(true)

    // The instalment absorbed the rate rise; the term did not move.
    expect(rows.length).toBeLessThanOrEqual(300 + 2)
    expect(totalCapital(rows)).toBe(floatingRateLoan().principal)
  })

  it('applies the reference floor before the margin, not after', () => {
    // The distinction that decided whether 2015-2021 borrowers benefited from
    // negative EURIBOR: floored at 0, a -0.5% fixing is treated as 0%.
    const floored = replay({
      loan: floatingRateLoan({ referenceFloor: 0 }),
      referenceRateAt: rateOf({ '2021-03': -0.005 }),
    })
    const unfloored = replay({
      loan: floatingRateLoan({ referenceFloor: null }),
      referenceRateAt: rateOf({ '2021-03': -0.005 }),
    })

    expect(floored[0]!.annualRate).toBeCloseTo(0.0055, 10)
    expect(unfloored[0]!.annualRate).toBeCloseTo(0.0005, 10)
    expect(totalInterest(floored) > totalInterest(unfloored)).toBe(true)
  })

  it('records the underlying fixing alongside the applied rate', () => {
    const rows = replay({
      loan: floatingRateLoan(),
      referenceRateAt: rateOf({ '2021-03': 0.005 }),
    })
    expect(rows[0]!.referenceRate).toBeCloseTo(0.005, 10)
    expect(rows[0]!.annualRate).toBeCloseTo(0.0105, 10)
  })

  it('rounds the applied rate when the agreement says to', () => {
    const rows = replay({
      loan: floatingRateLoan({ rateRounding: { decimals: 2, mode: 'HALF_UP' } }),
      referenceRateAt: rateOf({ '2021-03': 0.028_557 }),
    })
    // 2.8557% + 0.55% = 3.4057%, rounded to two decimals of a percent -> 3.41%.
    expect(rows[0]!.annualRate).toBeCloseTo(0.0341, 10)
  })

  it('refuses to invent a rate it was not given', () => {
    expect(() => replay({ loan: floatingRateLoan(), referenceRateAt: rateOf({}) })).toThrow(
      MissingRateError,
    )

    try {
      replay({ loan: floatingRateLoan(), referenceRateAt: rateOf({}) })
    } catch (error) {
      expect(error).toBeInstanceOf(MissingRateError)
      expect((error as MissingRateError).period).toBe(yearMonth(2021, 3))
      expect((error as MissingRateError).index.tenor).toBe('12M')
    }
  })
})

describe('replay — extra payments', () => {
  const baseline = replay({ loan: fixedRateLoan(), referenceRateAt: noRates })

  const recurring = (effect: 'SHORTEN_TERM' | 'LOWER_PAYMENT'): LoanEvent[] => [
    {
      kind: 'RECURRING_EXTRA',
      from: yearMonth(2021, 3),
      until: null,
      amount: fromMajorUnits(200),
      effect,
    },
  ]

  it('SHORTEN_TERM finishes the loan early and holds the instalment', () => {
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: recurring('SHORTEN_TERM'),
    })

    expect(rows.length).toBeLessThan(baseline.length)
    expect(rows[10]!.scheduledInstalment).toBe(baseline[10]!.scheduledInstalment)
    expect(totalInterest(rows) < totalInterest(baseline)).toBe(true)
    expect(totalCapital(rows) < fixedRateLoan().principal).toBe(true)
    expect(sum(rows.map((row) => sum([row.capital, row.extraPayment])))).toBe(
      fixedRateLoan().principal,
    )
  })

  it('LOWER_PAYMENT keeps the payoff date and shrinks the instalment', () => {
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: recurring('LOWER_PAYMENT'),
    })

    expect(rows[10]!.scheduledInstalment < baseline[10]!.scheduledInstalment).toBe(true)
    expect(rows[10]!.flags).toContain('EXTRA_PAYMENT')
    expect(sum(rows.map((row) => sum([row.capital, row.extraPayment])))).toBe(
      fixedRateLoan().principal,
    )
  })

  it('saves more interest by shortening the term than by lowering the payment', () => {
    // The headline comparison the app exists to make. Shortening wins because every
    // overpaid euro removes interest for the whole remaining term.
    const shorten = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: recurring('SHORTEN_TERM'),
    })
    const lower = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: recurring('LOWER_PAYMENT'),
    })

    expect(totalInterest(shorten) < totalInterest(lower)).toBe(true)
    expect(totalInterest(lower) < totalInterest(baseline)).toBe(true)
    expect(shorten.length < lower.length).toBe(true)
  })

  it('applies a one-off lump sum in the period it lands', () => {
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: [
        {
          kind: 'EXTRA_PAYMENT',
          period: yearMonth(2026, 12),
          amount: fromMajorUnits(10_000),
          effect: 'SHORTEN_TERM',
        },
      ],
    })

    const lump = rows.find((row) => row.period === yearMonth(2026, 12))!
    expect(lump.extraPayment).toBe(fromMajorUnits(10_000))
    expect(rows.filter((row) => row.extraPayment > ZERO)).toHaveLength(1)
    expect(rows.length).toBeLessThan(baseline.length)
  })

  it('never lets an overpayment push the balance below zero', () => {
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: [
        {
          kind: 'RECURRING_EXTRA',
          from: yearMonth(2021, 3),
          until: null,
          amount: fromMajorUnits(50_000),
          effect: 'SHORTEN_TERM',
        },
      ],
    })

    expect(rows.every((row) => row.closingBalance >= ZERO)).toBe(true)
    expect(sum(rows.map((row) => sum([row.capital, row.extraPayment])))).toBe(
      fixedRateLoan().principal,
    )
  })

  it('stops a bounded recurring overpayment at its end period', () => {
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: [
        {
          kind: 'RECURRING_EXTRA',
          from: yearMonth(2021, 3),
          until: yearMonth(2021, 8),
          amount: fromMajorUnits(100),
          effect: 'SHORTEN_TERM',
        },
      ],
    })

    expect(rows.filter((row) => row.extraPayment > ZERO)).toHaveLength(6)
    expect(rows.find((row) => row.period === yearMonth(2021, 9))!.extraPayment).toBe(ZERO)
  })
})

describe('replay — payment holidays', () => {
  it('PAY services the interest and leaves the balance untouched', () => {
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: [
        {
          kind: 'PAYMENT_HOLIDAY',
          from: yearMonth(2022, 1),
          until: yearMonth(2022, 3),
          interest: 'PAY',
        },
      ],
    })

    const holiday = rows.filter((row) => row.flags.includes('PAYMENT_HOLIDAY'))
    expect(holiday).toHaveLength(3)
    for (const row of holiday) {
      expect(isZero(row.capital)).toBe(true)
      expect(row.interest > ZERO).toBe(true)
      expect(row.closingBalance).toBe(row.openingBalance)
    }
  })

  it('CAPITALISE rolls the interest into the balance and costs more overall', () => {
    const events: LoanEvent[] = [
      {
        kind: 'PAYMENT_HOLIDAY',
        from: yearMonth(2022, 1),
        until: yearMonth(2022, 3),
        interest: 'CAPITALISE',
      },
    ]
    const rows = replay({ loan: fixedRateLoan(), referenceRateAt: noRates, events })
    const paid = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: [{ ...events[0]!, interest: 'PAY' } as LoanEvent],
    })

    const holiday = rows.filter((row) => row.flags.includes('PAYMENT_HOLIDAY'))
    for (const row of holiday) {
      expect(isZero(row.interest)).toBe(true)
      expect(row.capitalisedInterest > ZERO).toBe(true)
      expect(row.closingBalance > row.openingBalance).toBe(true)
      expect(row.flags).toContain('INTEREST_CAPITALISED')
    }

    expect(rows.length).toBeGreaterThan(paid.length)
  })
})

describe('replay — rate overrides and corrections', () => {
  it('an override forces the rate and lapses when its range ends', () => {
    const rows = replay({
      loan: floatingRateLoan(),
      referenceRateAt: rateOf({ '2021-03': 0.005, '2022-03': 0.005, '2023-03': 0.005 }),
      events: [
        {
          kind: 'RATE_OVERRIDE',
          from: yearMonth(2022, 1),
          until: yearMonth(2022, 6),
          annualRate: 0.06,
        },
      ],
    })

    expect(rows.find((row) => row.period === yearMonth(2021, 12))!.annualRate).toBeCloseTo(
      0.0105,
      10,
    )
    expect(rows.find((row) => row.period === yearMonth(2022, 2))!.annualRate).toBeCloseTo(0.06, 10)
    // Reverts as soon as the override lapses, rather than sticking until the next reset.
    expect(rows.find((row) => row.period === yearMonth(2022, 7))!.annualRate).toBeCloseTo(
      0.0105,
      10,
    )
  })

  it('a balance correction re-anchors the schedule to a real statement figure', () => {
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: [
        {
          kind: 'BALANCE_CORRECTION',
          period: yearMonth(2022, 1),
          closingBalance: fromMajorUnits(240_000),
        },
      ],
    })

    const corrected = rows.find((row) => row.period === yearMonth(2022, 1))!
    const next = rows.find((row) => row.period === yearMonth(2022, 2))!

    expect(corrected.closingBalance).toBe(fromMajorUnits(240_000))
    expect(corrected.flags).toContain('BALANCE_CORRECTED')
    expect(next.openingBalance).toBe(fromMajorUnits(240_000))
    expect(isZero(rows.at(-1)!.closingBalance)).toBe(true)
  })
})

describe('replay — refusing to produce nonsense', () => {
  it('rejects a loan that cannot amortise instead of looping forever', () => {
    // Interest-only in effect: the override keeps the rate far above what the
    // instalment, fixed at the original low rate, can service.
    const rows = () =>
      replay({
        loan: fixedRateLoan({ termMonths: 12, annualRate: 0.01 }),
        referenceRateAt: noRates,
        events: [
          { kind: 'RATE_OVERRIDE', from: yearMonth(2021, 4), until: null, annualRate: 0 },
          {
            kind: 'PAYMENT_HOLIDAY',
            from: yearMonth(2021, 4),
            until: yearMonth(2099, 12),
            interest: 'CAPITALISE',
          },
        ],
        maxPeriods: 24,
      })

    expect(rows).toThrow(NonAmortizingLoanError)
  })

  it('never emits negative capital, however violently the rate moves', () => {
    // For annuity repayment the instalment is resized on every rate change, so it
    // should always cover the interest and the negative-amortization guard should never
    // fire. This asserts the guarantee that guard exists to provide, rather than
    // asserting the guard fires — which for this strategy would be untrue.
    const rows = replay({
      loan: floatingRateLoan(),
      referenceRateAt: rateOf({ '2021-03': 0, '2022-03': 0.14, '2023-03': 0.001, '2024-03': 0.2 }),
      maxPeriods: 1200,
    })

    for (const row of rows) {
      expect(row.capital >= ZERO).toBe(true)
      expect(row.interest >= ZERO).toBe(true)
    }
    expect(rows.some((row) => row.flags.includes('NEGATIVE_AMORTIZATION'))).toBe(false)
  })

  it('resizes the instalment when a payment holiday ends', () => {
    // Without this the loan leaves the holiday with a larger balance, fewer periods
    // left, and an instalment sized for neither — so it would fail to amortise.
    const rows = replay({
      loan: fixedRateLoan(),
      referenceRateAt: noRates,
      events: [
        {
          kind: 'PAYMENT_HOLIDAY',
          from: yearMonth(2022, 1),
          until: yearMonth(2022, 12),
          interest: 'CAPITALISE',
        },
      ],
    })

    const duringHoliday = rows.find((row) => row.period === yearMonth(2022, 6))!
    const afterHoliday = rows.find((row) => row.period === yearMonth(2023, 1))!

    expect(afterHoliday.flags).toContain('PAYMENT_RECALCULATED')
    expect(afterHoliday.scheduledInstalment > duringHoliday.scheduledInstalment).toBe(true)
    expect(isZero(rows.at(-1)!.closingBalance)).toBe(true)
  })

  it('rejects structurally invalid loans', () => {
    expect(() =>
      replay({ loan: fixedRateLoan({ termMonths: 0 }), referenceRateAt: noRates }),
    ).toThrow(RangeError)
    expect(() =>
      replay({ loan: fixedRateLoan({ principal: ZERO }), referenceRateAt: noRates }),
    ).toThrow(RangeError)
    expect(() =>
      replay({ loan: floatingRateLoan({ resetMonths: 0 }), referenceRateAt: rateOf({}) }),
    ).toThrow(RangeError)
  })
})

describe('replay — day-count conventions', () => {
  it('ACT/360 charges more interest than the nominal monthly assumption', () => {
    // 365 real days divided by a 360-day year is about 1.4% more interest per year.
    const nominal = replay({
      loan: fixedRateLoan({ dayCount: 'MONTHLY_NOMINAL' }),
      referenceRateAt: noRates,
    })
    const act360 = replay({
      loan: fixedRateLoan({ dayCount: 'ACT_360' }),
      referenceRateAt: noRates,
    })

    expect(totalInterest(act360) > totalInterest(nominal)).toBe(true)

    const ratio = Number(toCents(totalInterest(act360))) / Number(toCents(totalInterest(nominal)))
    expect(ratio).toBeGreaterThan(1.005)
    expect(ratio).toBeLessThan(1.06)
  })

  it('repays exactly the principal under every convention', () => {
    for (const dayCount of [
      'MONTHLY_NOMINAL',
      'ACT_360',
      'ACT_365',
      'THIRTY_360_EU',
      'THIRTY_360_US',
    ] as const) {
      const loan = fixedRateLoan({ dayCount })
      const rows = replay({ loan, referenceRateAt: noRates })
      expect(totalCapital(rows)).toBe(loan.principal)
      expect(isZero(rows.at(-1)!.closingBalance)).toBe(true)
    }
  })

  it('accrues from drawdown to the first payment, not from the first payment', () => {
    // Drawn down six weeks before the first instalment: that first period carries more
    // interest than a clean month.
    const early = replay({
      loan: fixedRateLoan({ drawdownDate: localDate(2021, 1, 15), dayCount: 'ACT_360' }),
      referenceRateAt: noRates,
    })
    const same = replay({
      loan: fixedRateLoan({ drawdownDate: localDate(2021, 2, 15), dayCount: 'ACT_360' }),
      referenceRateAt: noRates,
    })

    expect(early[0]!.interest > same[0]!.interest).toBe(true)
  })
})

describe('replay — determinism', () => {
  it('produces identical output for identical input', () => {
    const run = () =>
      replay({
        loan: floatingRateLoan(),
        referenceRateAt: rateOf({ '2021-03': 0.005, '2022-03': 0.03, '2023-03': 0.038 }),
        events: [
          {
            kind: 'RECURRING_EXTRA',
            from: yearMonth(2022, 1),
            until: null,
            amount: fromMajorUnits(150),
            effect: 'SHORTEN_TERM',
          },
        ],
      })

    expect(run()).toEqual(run())
  })
})
