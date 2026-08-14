import type { LoanEvent } from '@/domain/scenario'

import { describe, expect, it } from 'vitest'

import { localDate, yearMonth } from '@/domain/dates'
import { fromMajorUnits, toCents } from '@/domain/money'
import { fixedRateLoan, floatingRateLoan } from '@/domain/testing/fixtures'
import {
  fromStoredEvent,
  fromStoredLoan,
  storedLoanSchema,
  storedScenarioSchema,
  toStoredEvent,
  toStoredLoan,
} from '@/persistence/schema'

/**
 * Every event kind, round-tripped.
 *
 * The mapping is a pair of exhaustive switches, and a missed branch there means a user's
 * scenario silently loses an event on reload — the kind of data loss nobody notices until
 * the numbers stop matching.
 */
const EVERY_EVENT: readonly LoanEvent[] = [
  {
    kind: 'EXTRA_PAYMENT',
    period: yearMonth(2026, 12),
    amount: fromMajorUnits(10_000),
    effect: 'SHORTEN_TERM',
  },
  {
    kind: 'RECURRING_EXTRA',
    from: yearMonth(2026, 9),
    until: yearMonth(2030, 9),
    amount: fromMajorUnits(200),
    effect: 'LOWER_PAYMENT',
  },
  {
    kind: 'RECURRING_EXTRA',
    from: yearMonth(2026, 9),
    until: null,
    amount: fromMajorUnits(150),
    effect: 'SHORTEN_TERM',
  },
  {
    kind: 'PAYMENT_HOLIDAY',
    from: yearMonth(2027, 1),
    until: yearMonth(2027, 6),
    interest: 'PAY',
  },
  {
    kind: 'PAYMENT_HOLIDAY',
    from: yearMonth(2028, 1),
    until: yearMonth(2028, 3),
    interest: 'CAPITALISE',
  },
  {
    kind: 'RATE_OVERRIDE',
    from: yearMonth(2029, 1),
    until: yearMonth(2029, 12),
    annualRate: 0.06,
  },
  { kind: 'RATE_OVERRIDE', from: yearMonth(2030, 1), until: null, annualRate: 0.045 },
  {
    kind: 'BALANCE_CORRECTION',
    period: yearMonth(2026, 6),
    closingBalance: fromMajorUnits(198_432.17),
  },
]

describe('event mapping', () => {
  it('round-trips every event kind exactly', () => {
    for (const event of EVERY_EVENT) {
      expect(fromStoredEvent(toStoredEvent(event))).toEqual(event)
    }
  })

  it('covers every kind the domain defines', () => {
    // Guards against an event kind being added to the domain and forgotten here.
    const covered = new Set(EVERY_EVENT.map((event) => event.kind))
    expect([...covered].toSorted()).toEqual([
      'BALANCE_CORRECTION',
      'EXTRA_PAYMENT',
      'PAYMENT_HOLIDAY',
      'RATE_OVERRIDE',
      'RECURRING_EXTRA',
    ])
  })

  it('stores amounts as decimal minor units', () => {
    const stored = toStoredEvent(EVERY_EVENT[0]!)
    expect(stored.kind === 'EXTRA_PAYMENT' ? stored.amount : null).toBe('1000000')
  })

  it('survives serialisation, which a bigint would not', () => {
    expect(() => JSON.stringify(EVERY_EVENT.map(toStoredEvent))).not.toThrow()
  })

  it('validates as part of a scenario', () => {
    const result = storedScenarioSchema.safeParse({
      id: 's1',
      loanId: 'l1',
      name: 'Everything',
      events: EVERY_EVENT.map(toStoredEvent),
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown event kind', () => {
    const result = storedScenarioSchema.safeParse({
      id: 's1',
      loanId: 'l1',
      name: 'Bad',
      events: [{ kind: 'SOMETHING_ELSE', period: '2026-01' }],
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('loan mapping', () => {
  it('round-trips a floating-rate loan with every option set', () => {
    const loan = floatingRateLoan({
      monthlyServicing: fromMajorUnits(2.5),
      perRateReset: fromMajorUnits(10),
      referenceFloor: 0,
      rateRounding: { decimals: 3, mode: 'HALF_EVEN' },
      dayCount: 'ACT_360',
      rounding: 'HALF_EVEN',
      drawdownDate: localDate(2021, 1, 31),
      paymentDay: 31,
    })
    expect(fromStoredLoan(toStoredLoan(loan))).toEqual(loan)
  })

  it('round-trips a floating-rate loan with no floor and no rate rounding', () => {
    const loan = floatingRateLoan({ referenceFloor: null, rateRounding: null })
    expect(fromStoredLoan(toStoredLoan(loan))).toEqual(loan)
  })

  it('round-trips every day-count convention', () => {
    for (const dayCount of [
      'MONTHLY_NOMINAL',
      'ACT_360',
      'ACT_365',
      'THIRTY_360_EU',
      'THIRTY_360_US',
    ] as const) {
      const loan = fixedRateLoan({ dayCount })
      expect(fromStoredLoan(toStoredLoan(loan)).dayCount).toBe(dayCount)
    }
  })

  it('round-trips every rounding mode', () => {
    for (const rounding of ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] as const) {
      const loan = fixedRateLoan({ rounding })
      expect(fromStoredLoan(toStoredLoan(loan)).rounding).toBe(rounding)
    }
  })

  it('keeps a negative amount exact, for a correction that raises the balance', () => {
    const stored = toStoredEvent({
      kind: 'BALANCE_CORRECTION',
      period: yearMonth(2026, 6),
      closingBalance: fromMajorUnits(-1.23),
    })
    expect(stored.kind === 'BALANCE_CORRECTION' ? stored.closingBalance : null).toBe('-123')

    const back = fromStoredEvent(stored)
    expect(
      toCents(back.kind === 'BALANCE_CORRECTION' ? back.closingBalance : fromMajorUnits(0)),
    ).toBe(-123n)
  })

  it('rejects a currency code of the wrong length', () => {
    const stored = { ...toStoredLoan(fixedRateLoan()), currency: 'EURO' }
    expect(storedLoanSchema.safeParse(stored).success).toBe(false)
  })

  it('rejects a payment day outside the calendar', () => {
    for (const paymentDay of [0, 32]) {
      const stored = { ...toStoredLoan(fixedRateLoan()), paymentDay }
      expect(storedLoanSchema.safeParse(stored).success).toBe(false)
    }
  })

  it('rejects a non-positive term', () => {
    const stored = { ...toStoredLoan(fixedRateLoan()), termMonths: 0 }
    expect(storedLoanSchema.safeParse(stored).success).toBe(false)
  })

  it('rejects a floating loan with no provider named', () => {
    const stored = toStoredLoan(floatingRateLoan())
    const damaged = {
      ...stored,
      rateBasis: { ...stored.rateBasis, reference: { providerId: '', tenor: '12M' } },
    }
    expect(storedLoanSchema.safeParse(damaged).success).toBe(false)
  })

  it('rejects an unknown tenor', () => {
    const stored = toStoredLoan(floatingRateLoan())
    const damaged = {
      ...stored,
      rateBasis: { ...stored.rateBasis, reference: { providerId: 'ecb', tenor: '9M' } },
    }
    expect(storedLoanSchema.safeParse(damaged).success).toBe(false)
  })
})
