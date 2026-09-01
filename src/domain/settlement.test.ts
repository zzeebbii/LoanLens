import type { LoanEvent } from '@/domain/scenario'

import { describe, expect, it } from 'vitest'

import { localDate, settlementDateFor, yearMonth } from '@/domain/dates'
import { fromMajorUnits, toMajorUnits } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { floatingRateLoan } from '@/domain/testing/fixtures'

/**
 * Weekend settlement, and the interest it moves.
 *
 * This came out of reconciling the engine against a real Finnish mortgage. Fifteen of twenty
 * months tied out to the cent; the five that did not were each the month *after* an
 * instalment whose due date fell on a weekend. A direct debit cannot settle on a Sunday, so
 * the capital reduction landed on the Monday, the balance stayed higher for those days, and
 * the following period was charged for them.
 *
 * The amounts are small — two to twelve cents a time — but they are the difference between a
 * schedule that ties out to a statement and one that drifts, and the drift only ever goes one
 * way. Modelling it took the whole reconstruction from "close" to exact on every row.
 */
describe('settlementDateFor', () => {
  it('leaves a business day alone', () => {
    // A Tuesday.
    expect(settlementDateFor(localDate(2022, 12, 20), 'FOLLOWING')).toEqual(localDate(2022, 12, 20))
  })

  it('moves a Sunday to the Monday', () => {
    expect(settlementDateFor(localDate(2022, 11, 20), 'FOLLOWING')).toEqual(localDate(2022, 11, 21))
  })

  it('moves a Saturday two days, not one', () => {
    expect(settlementDateFor(localDate(2023, 5, 20), 'FOLLOWING')).toEqual(localDate(2023, 5, 22))
  })

  it('rolls across a month boundary', () => {
    // Saturday 30 September 2023 settles on Monday 2 October.
    expect(settlementDateFor(localDate(2023, 9, 30), 'FOLLOWING')).toEqual(localDate(2023, 10, 2))
  })

  it('rolls across a year boundary', () => {
    // Sunday 31 December 2023 settles on Monday 1 January 2024.
    expect(settlementDateFor(localDate(2023, 12, 31), 'FOLLOWING')).toEqual(localDate(2024, 1, 1))
  })

  it('does nothing at all under NONE, whatever day it is', () => {
    expect(settlementDateFor(localDate(2022, 11, 20), 'NONE')).toEqual(localDate(2022, 11, 20))
  })
})

/** A loan whose 20th falls on a Sunday in November 2022, drawn on a weekday. */
const base = {
  principal: fromMajorUnits(100_000),
  drawdownDate: localDate(2022, 10, 20),
  firstPaymentPeriod: yearMonth(2022, 11),
  paymentDay: 20,
  termMonths: 120,
  marginBps: 100,
  firstResetPeriod: yearMonth(2032, 10),
  dayCount: 'ACT_360' as const,
  monthlyServicing: fromMajorUnits(0),
}
const rateAt = () => 0.03
const NO_EVENTS: readonly LoanEvent[] = []

describe('settlement lag in the schedule', () => {
  const onCalendar = replay({
    loan: floatingRateLoan({ ...base, settlement: 'NONE' }),
    referenceRateAt: rateAt,
    events: NO_EVENTS,
  })
  const onBusinessDays = replay({
    loan: floatingRateLoan({ ...base, settlement: 'FOLLOWING' }),
    referenceRateAt: rateAt,
    events: NO_EVENTS,
  })

  it('charges the same for the first period, which no lag can reach', () => {
    // The lag applies to the period *after* a weekend due date, never its own.
    expect(onBusinessDays[0]!.interest).toBe(onCalendar[0]!.interest)
  })

  it('charges more in the month after a weekend due date', () => {
    // 20 November 2022 is a Sunday, so December carries one extra day of the old balance.
    expect(toMajorUnits(onBusinessDays[1]!.interest)).toBeGreaterThan(
      toMajorUnits(onCalendar[1]!.interest),
    )
  })

  it('charges the extra day on the balance that was actually outstanding', () => {
    const opening = onCalendar[0]!.openingBalance
    const afterPayment = onCalendar[0]!.closingBalance
    const dailyDifference = (toMajorUnits(opening) - toMajorUnits(afterPayment)) * (0.04 / 360)

    const extra = toMajorUnits(onBusinessDays[1]!.interest) - toMajorUnits(onCalendar[1]!.interest)

    // One day of interest on the capital that had not yet been repaid.
    expect(extra).toBeCloseTo(dailyDifference, 2)
  })

  it('leaves a month whose due date is midweek untouched', () => {
    // 20 January 2023 is a Friday and 20 February a Monday, so February carries no lag.
    const january = onBusinessDays.find((row) => row.period === '2023-02')!
    const plain = onCalendar.find((row) => row.period === '2023-02')!
    expect(january.interest).toBe(plain.interest)
  })

  it('costs the borrower more over the whole loan, never less', () => {
    const withLag = onBusinessDays.reduce((total, row) => total + toMajorUnits(row.interest), 0)
    const without = onCalendar.reduce((total, row) => total + toMajorUnits(row.interest), 0)

    expect(withLag).toBeGreaterThan(without)
  })

  it('still clears the loan exactly', () => {
    expect(onBusinessDays.at(-1)!.closingBalance).toBe(0n)
  })
})
