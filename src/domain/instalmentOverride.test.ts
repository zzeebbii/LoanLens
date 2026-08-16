import type { LoanEvent } from '@/domain/scenario'

import { describe, expect, it } from 'vitest'

import { localDate, yearMonth } from '@/domain/dates'
import { fromMajorUnits, toMajorUnits } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { floatingRateLoan } from '@/domain/testing/fixtures'

/**
 * Taking the instalment from a statement instead of deriving it.
 *
 * The numbers are a real Finnish mortgage, because the case for this feature is not obvious
 * in the abstract. Its contract fixed a "variable annuity" of 897.42 when the rate was 3.63%.
 * By drawdown two months later the rate was 3.976%, and the lender charged 901.37 — not the
 * 918.61 that rate and term imply, because a variable annuity is struck at a reset and then
 * held. Nothing about the loan is mis-entered: the payment is an input, not an output.
 *
 * Left to derive it, the model overpays capital by 17 euro a month, which is a thousand euro
 * of balance inside four years — and the balance is the number the borrower actually checks.
 */
const loan = floatingRateLoan({
  principal: fromMajorUnits(124391),
  drawdownDate: localDate(2022, 9, 27),
  firstPaymentPeriod: yearMonth(2022, 11),
  paymentDay: 20,
  termMonths: 180,
  marginBps: 54.6,
  cap: {
    ceiling: 0.02,
    premiumBps: 143,
    from: yearMonth(2022, 9),
    until: yearMonth(2027, 9),
  },
  firstResetPeriod: yearMonth(2023, 9),
  dayCount: 'ACT_360',
  monthlyServicing: fromMajorUnits(2.5),
})

/** 12M EURIBOR was above the 2% ceiling throughout, so the capped rate holds at 3.976%. */
const euribor = () => 0.0223

const held: readonly LoanEvent[] = [
  {
    kind: 'INSTALMENT_OVERRIDE',
    from: yearMonth(2022, 11),
    until: yearMonth(2023, 8),
    amount: fromMajorUnits(901.37),
  },
]

describe('INSTALMENT_OVERRIDE', () => {
  it('derives the textbook annuity when nothing overrides it', () => {
    const rows = replay({ loan, referenceRateAt: euribor })

    expect(toMajorUnits(rows[0]!.scheduledInstalment)).toBeCloseTo(918.61, 2)
  })

  it('charges the payment the lender actually took, when one is given', () => {
    const rows = replay({ loan, referenceRateAt: euribor, events: held })

    expect(toMajorUnits(rows[0]!.scheduledInstalment)).toBeCloseTo(901.37, 2)
  })

  it('reproduces the split on the statement, which the derived payment does not', () => {
    const rows = replay({ loan, referenceRateAt: euribor, events: held })

    // The bank's first two rows: 741.87/159.50, then 411.64/489.73.
    expect(toMajorUnits(rows[0]!.interest)).toBeCloseTo(741.87, 1)
    expect(toMajorUnits(rows[0]!.capital)).toBeCloseTo(159.5, 1)
    expect(toMajorUnits(rows[1]!.capital)).toBeCloseTo(489.73, 1)
  })

  it('leaves the interest alone, since only the payment was forced', () => {
    const derived = replay({ loan, referenceRateAt: euribor })
    const forced = replay({ loan, referenceRateAt: euribor, events: held })

    // Same rate, same balance, same day count: the first period cannot differ.
    expect(forced[0]!.interest).toBe(derived[0]!.interest)
  })

  it('marks the rows it applied to, so the schedule does not look derived', () => {
    const rows = replay({ loan, referenceRateAt: euribor, events: held })

    expect(rows[0]!.flags).toContain('INSTALMENT_OVERRIDDEN')
  })

  it('resizes the payment once the override lapses, rather than carrying it forever', () => {
    const rows = replay({ loan, referenceRateAt: euribor, events: held })
    const afterwards = rows.find((row) => row.period === '2023-09')!

    expect(toMajorUnits(afterwards.scheduledInstalment)).not.toBeCloseTo(901.37, 2)
    expect(afterwards.flags).toContain('PAYMENT_RECALCULATED')
  })

  it('still clears the loan exactly, despite being underpaid for ten months', () => {
    const rows = replay({ loan, referenceRateAt: euribor, events: held })

    expect(rows.at(-1)!.closingBalance).toBe(0n)
  })

  it('holds the payment across a rate reset inside its own range', () => {
    const spanning: readonly LoanEvent[] = [
      {
        kind: 'INSTALMENT_OVERRIDE',
        from: yearMonth(2022, 11),
        until: yearMonth(2024, 6),
        amount: fromMajorUnits(901.37),
      },
    ]
    const rows = replay({ loan, referenceRateAt: euribor, events: spanning })
    const afterReset = rows.find((row) => row.period === '2023-10')!

    // A reset would normally re-strike the payment; a statement figure outranks it.
    expect(toMajorUnits(afterReset.scheduledInstalment)).toBeCloseTo(901.37, 2)
  })
})
