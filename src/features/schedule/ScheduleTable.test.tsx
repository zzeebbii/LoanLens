// @vitest-environment jsdom

import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/app/testing/renderApp'
import { totals } from '@/domain/analytics'
import { yearMonth } from '@/domain/dates'
import { sum, toMajorUnits } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { fixedRateLoan, noRates } from '@/domain/testing/fixtures'
import { ScheduleTable } from '@/features/schedule/ScheduleTable'

/**
 * The totals row, and the currency.
 *
 * A column of figures with no sum at the bottom makes the reader do arithmetic the machine
 * already did — and a column of bare numbers makes them guess the unit. Neither is visible
 * in a unit test as *layout*, but both are visible as content, which is the part that can
 * silently disappear in a refactor.
 */
const loan = fixedRateLoan()
const rows = replay({ loan, referenceRateAt: noRates })

function totalsRow(): HTMLElement {
  const rowsFound = within(screen.getByRole('table')).getAllByRole('row')
  return rowsFound.at(-1) as HTMLElement
}

/** The exact decimal strings the row carries, independent of locale formatting. */
function exactValues(row: HTMLElement): string[] {
  return [...row.querySelectorAll('[data-value]')].map((el) => el.getAttribute('data-value') ?? '')
}

describe('ScheduleTable totals', () => {
  it('sums the columns rather than leaving the reader to add them up', async () => {
    await renderWithProviders(<ScheduleTable loan={loan} rows={rows} asOf={yearMonth(2021, 3)} />)

    const expected = totals(rows)

    // Asserted on the exact value rather than the rendered text, which carries a currency
    // symbol and locale thousands separators that say nothing about whether the sum is right.
    expect(exactValues(totalsRow())).toContain(toMajorUnits(expected.interest).toFixed(2))
  })

  it('totals only the rows it was given, so a filtered table stays honest', async () => {
    const firstYear = rows.slice(0, 12)
    await renderWithProviders(
      <ScheduleTable loan={loan} rows={firstYear} asOf={yearMonth(2021, 3)} />,
    )

    const shown = totalsRow()
    expect(within(shown).getByText(/Total of 12 instalments/)).toBeDefined()
    expect(exactValues(shown)).toContain(toMajorUnits(totals(firstYear).interest).toFixed(2))
    // The whole-loan interest must not appear under a twelve-row table.
    expect(exactValues(shown)).not.toContain(toMajorUnits(totals(rows).interest).toFixed(2))
  })

  it('carries the exact summed value, not just a formatted one', async () => {
    await renderWithProviders(<ScheduleTable loan={loan} rows={rows} asOf={yearMonth(2021, 3)} />)

    // Three summed columns: interest, capital and the total paid.
    expect(exactValues(totalsRow())).toHaveLength(3)
  })

  it('shows the loan currency on amounts, since the number alone has no unit', async () => {
    await renderWithProviders(<ScheduleTable loan={loan} rows={rows} asOf={yearMonth(2021, 3)} />)

    // EUR renders as € in every locale this app ships.
    expect(screen.getAllByText(/€/).length).toBeGreaterThan(0)
  })

  it('does not pretend a closing balance can be summed', async () => {
    await renderWithProviders(<ScheduleTable loan={loan} rows={rows} asOf={yearMonth(2021, 3)} />)

    // Balances are positions, not flows. Adding 300 of them would be a meaningless number
    // presented with the same authority as the real totals beside it.
    const nonsense = toMajorUnits(sum(rows.map((row) => row.closingBalance))).toFixed(2)
    expect(exactValues(totalsRow())).not.toContain(nonsense)
  })
})
