// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { horizonFor } from '@/app/hooks/useRateSeries'
import { renderWithProviders, stubRateProvider } from '@/app/testing/renderApp'
import { totals } from '@/domain/analytics'
import { replay } from '@/domain/schedule'
import { fixedRateLoan, floatingRateLoan, noRates } from '@/domain/testing/fixtures'
import { LoanSummary } from '@/features/loan/LoanSummary'
import { DEFAULT_SETTINGS, InMemoryLoanRepository } from '@/persistence'

/**
 * The summary is where the engine's numbers first meet a user.
 *
 * These assert on the *rendered* figures, not on the engine — the engine has its own tests.
 * What is being checked here is that the right number reaches the right label, formatted for
 * the locale, which is exactly the wiring a unit test of either layer alone would miss.
 */
const loan = fixedRateLoan()
const rows = replay({ loan, referenceRateAt: noRates })
const schedule = { rows, totals: totals(rows), error: null } as const

describe('LoanSummary', () => {
  it('shows the total interest the engine computed, formatted', async () => {
    await renderWithProviders(<LoanSummary loan={loan} schedule={schedule} usedFallback={false} />)

    // 121,457.49 from the reference schedule, rounded to whole units for the headline.
    expect(await screen.findByText('€121,457')).toBeDefined()
  })

  it('labels every headline figure', async () => {
    await renderWithProviders(<LoanSummary loan={loan} schedule={schedule} usedFallback={false} />)

    // Wait for the first label, then assert the rest synchronously — they render together.
    expect(await screen.findByText('Still owed')).toBeDefined()

    for (const label of [
      'Current instalment',
      'Current rate',
      'Interest so far',
      'Final instalment',
      'Total interest',
    ]) {
      expect(screen.getByText(label)).toBeDefined()
    }
  })

  it('exposes the exact amount alongside the formatted one', async () => {
    // The formatted headline is rounded; anything reading the DOM gets the exact cents.
    const { container } = await renderWithProviders(
      <LoanSummary loan={loan} schedule={schedule} usedFallback={false} />,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-value="121457.49"]')).not.toBeNull()
    })
  })

  it('warns when the figures came from the bundled snapshot rather than the ECB', async () => {
    await renderWithProviders(<LoanSummary loan={loan} schedule={schedule} usedFallback />)

    expect(
      await screen.findByText(/Could not reach the ECB, so the built-in data is being used/),
    ).toBeDefined()
  })

  it('says nothing about fallbacks when the live source answered', async () => {
    await renderWithProviders(<LoanSummary loan={loan} schedule={schedule} usedFallback={false} />)

    expect(screen.queryByText(/Could not reach the ECB/)).toBeNull()
  })

  it('shows a placeholder rather than zeroes while the schedule is unavailable', async () => {
    const { container } = await renderWithProviders(
      <LoanSummary loan={loan} schedule={null} usedFallback={false} />,
    )

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(screen.queryByText('Total interest')).toBeNull()
  })

  it('formats money for the locale the user chose, not for English', async () => {
    // A Finnish user writes 121 457 €, with the symbol trailing and a space as the group
    // separator. Nothing in the component knows that — it comes from the stored setting.
    const repository = new InMemoryLoanRepository()
    await repository.saveSettings({ ...DEFAULT_SETTINGS, locale: 'fi-FI' })

    await renderWithProviders(
      <LoanSummary loan={loan} schedule={schedule} usedFallback={false} />,
      { repository },
    )

    const total = await screen.findByText(/121\s457/)
    expect(total.textContent).toContain('€')
    expect(total.textContent).not.toContain('121,457')
  })
})

describe('the rate horizon', () => {
  it('reaches past the end of the loan, so the schedule is never cut short', () => {
    // A horizon that stopped at the term would leave the final adjusting payment without a
    // rate, and the engine would refuse the whole schedule.
    expect(horizonFor(floatingRateLoan()) > '2046-03').toBe(true)
  })
})

describe('stubRateProvider', () => {
  it('serves a deterministic series so tests do not depend on the network', async () => {
    const series = await stubRateProvider(3).getSeries({
      tenor: '12M',
      from: '1999-01' as never,
      to: '2050-01' as never,
    })

    expect(series.points[0]?.rate).toBeCloseTo(0.03, 10)
  })
})
