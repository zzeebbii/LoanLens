import { describe, expect, it } from 'vitest'

import { localDate, nominalStubShortfallDays } from '@/domain/dates'

/**
 * The first period, which is the one a nominal day count gets wrong.
 *
 * These numbers come from a real Finnish mortgage: drawn down on 27 September 2022 against a
 * first payment on 20 November, where the bank charged 741.87 of interest and the app — set
 * to the nominal convention — charged 412.15. The whole difference is the 24 days below.
 */
describe('nominalStubShortfallDays', () => {
  it('counts the days a nominal month drops from a real drawdown gap', () => {
    // 54 actual days, charged as 30.
    expect(nominalStubShortfallDays(localDate(2022, 9, 27), localDate(2022, 11, 20))).toBe(24)
  })

  it('is silent when the drawdown lands on the payment day', () => {
    expect(nominalStubShortfallDays(localDate(2022, 10, 20), localDate(2022, 11, 20))).toBe(0)
  })

  it('is silent across a whole number of months', () => {
    expect(nominalStubShortfallDays(localDate(2022, 9, 20), localDate(2022, 11, 20))).toBe(0)
  })

  it('is worst when the drawdown just misses the payment day', () => {
    // 21 Sep -> 20 Nov is 60 real days, but the convention can only count one whole month,
    // because the 20th never reaches the 21st. Half the period goes uncharged.
    expect(nominalStubShortfallDays(localDate(2022, 9, 21), localDate(2022, 11, 20))).toBe(30)
  })

  it('charges an ordinary 31-day month in full, rather than inventing a shortfall', () => {
    // The trap in measuring this by year fractions: a nominal month is 30.4 days, so every
    // long month would report a day of phantom shortfall and the warning would never be off.
    expect(nominalStubShortfallDays(localDate(2022, 7, 20), localDate(2022, 8, 20))).toBe(0)
    expect(nominalStubShortfallDays(localDate(2022, 1, 31), localDate(2022, 2, 28))).toBe(0)
  })
})
