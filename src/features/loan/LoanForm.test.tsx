// @vitest-environment jsdom

import type { Loan } from '@/domain/loan'

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/app/testing/renderApp'
import { yearMonth } from '@/domain/dates'
import { toCents } from '@/domain/money'
import { fixedRateLoan, floatingRateLoan } from '@/domain/testing/fixtures'
import { emptyLoanDraft, loanToDraft } from '@/features/loan/loanDraft'
import { LoanForm } from '@/features/loan/LoanForm'
import { DEFAULT_SETTINGS } from '@/persistence'

/**
 * The form is the only place a user's real loan enters the app.
 *
 * These drive it the way a person does — typing into labelled fields and pressing the button —
 * and then assert on the `Loan` that comes out. That is the seam where a mistake would be both
 * invisible and expensive: an amount off by a factor of a hundred, or a percentage stored as a
 * fraction, produces a schedule that looks entirely plausible and is wrong.
 */
const blankDraft = () => emptyLoanDraft(DEFAULT_SETTINGS, new Date('2026-08-14T00:00:00Z'))

async function renderForm(handlers: {
  onSubmit?: (loan: Loan) => void
  onCancel?: () => void
  defaultValues?: ReturnType<typeof blankDraft>
  submitLabel?: string
}) {
  return renderWithProviders(
    <LoanForm
      defaultValues={handlers.defaultValues ?? blankDraft()}
      submitLabel={handlers.submitLabel ?? 'Add loan'}
      onSubmit={handlers.onSubmit ?? vi.fn()}
      onCancel={handlers.onCancel ?? vi.fn()}
    />,
  )
}

async function fillMinimum(user: ReturnType<typeof userEvent.setup>, name = 'My mortgage') {
  await user.type(screen.getByLabelText('Name'), name)
  await user.clear(screen.getByLabelText('Amount borrowed'))
  await user.type(screen.getByLabelText('Amount borrowed'), '250000')
}

describe('LoanForm', () => {
  it('turns typed input into a loan, converting units correctly', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({ onSubmit })
    await fillMinimum(user)
    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    expect(onSubmit).toHaveBeenCalledOnce()
    const loan = onSubmit.mock.calls[0]![0]

    // 250000 typed in major units becomes exactly 25,000,000 minor units.
    expect(toCents(loan.principal)).toBe(25_000_000n)
    expect(loan.name).toBe('My mortgage')
    expect(loan.termMonths).toBe(300)
    expect(loan.amortization).toBe('ANNUITY')
  })

  it('stores a margin typed as a percentage in basis points', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({ onSubmit })
    await fillMinimum(user)
    await user.clear(screen.getByLabelText('Margin'))
    await user.type(screen.getByLabelText('Margin'), '0.55')
    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    const loan = onSubmit.mock.calls[0]![0]
    expect(loan.rateBasis.kind).toBe('FLOATING')
    // 0.55% typed becomes 55 basis points, not 0.55 of them.
    if (loan.rateBasis.kind === 'FLOATING') {
      expect(loan.rateBasis.marginBps).toBeCloseTo(55, 6)
      // Floored by default, because most euro-area agreements floor the reference at zero.
      expect(loan.rateBasis.referenceFloor).toBe(0)
    }
  })

  it('accepts a comma decimal separator, as a euro-area keyboard produces', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({ onSubmit })
    await user.type(screen.getByLabelText('Name'), 'Comma loan')
    await user.clear(screen.getByLabelText('Amount borrowed'))
    await user.type(screen.getByLabelText('Amount borrowed'), '250000,50')
    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    expect(toCents(onSubmit.mock.calls[0]![0].principal)).toBe(25_000_050n)
  })

  it('refuses to submit without a name, and says which field is wrong', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({ onSubmit })
    await user.clear(screen.getByLabelText('Amount borrowed'))
    await user.type(screen.getByLabelText('Amount borrowed'), '250000')
    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    expect(onSubmit).not.toHaveBeenCalled()
    // A translated message, not a raw i18n key.
    expect(await screen.findByText('Give the loan a name')).toBeDefined()
  })

  it('refuses an amount that is not a number', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({ onSubmit })
    await user.type(screen.getByLabelText('Name'), 'Bad amount')
    await user.clear(screen.getByLabelText('Amount borrowed'))
    await user.type(screen.getByLabelText('Amount borrowed'), 'not a number')
    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText(/Enter an amount/)).toBeDefined()
  })

  it('marks an invalid field for assistive technology, not just visually', async () => {
    const user = userEvent.setup()

    await renderForm({})
    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    const name = await screen.findByLabelText('Name')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    // The error text is associated with the field, so a screen reader announces it.
    expect(name.getAttribute('aria-describedby')).not.toBeNull()
  })

  it('round-trips an existing loan without altering it', async () => {
    const user = userEvent.setup()
    const original = fixedRateLoan({ name: 'Existing' })
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({
      onSubmit,
      defaultValues: loanToDraft(original),
      submitLabel: 'Save changes',
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // Submitting an untouched form must reproduce the loan exactly — otherwise merely opening
    // the edit screen would silently change someone's figures.
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0]![0]).toEqual(original)
  })

  it('warns that the interest-calculation choice matters', async () => {
    await renderForm({})

    // This is the setting most likely to make the model disagree with a real statement, so the
    // form has to say so rather than leaving a silent default.
    expect(await screen.findByText(/can change the total interest by thousands/)).toBeDefined()
  })

  it('explains that the reference floor is why a negative rate did not help', async () => {
    await renderForm({})

    expect(await screen.findByText(/stop the reference rate going below 0%/)).toBeDefined()
  })

  it('can be cancelled without submitting', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onSubmit = vi.fn()

    await renderForm({ onSubmit, onCancel })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('stores a cap the way a bank quotes it: percentages in, fractions and bps out', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({ onSubmit })
    await fillMinimum(user, 'Capped loan')

    await user.click(screen.getByLabelText('This loan has a rate cap'))
    await user.clear(screen.getByLabelText('Reference rate capped at'))
    await user.type(screen.getByLabelText('Reference rate capped at'), '3')
    await user.clear(screen.getByLabelText('Fee for the cap'))
    await user.type(screen.getByLabelText('Fee for the cap'), '0.35')

    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    const loan = onSubmit.mock.calls[0]![0]
    expect(loan.rateBasis.kind).toBe('FLOATING')
    if (loan.rateBasis.kind === 'FLOATING') {
      // 3% typed becomes the fraction 0.03; 0.35% becomes 35 basis points.
      expect(loan.rateBasis.cap?.ceiling).toBeCloseTo(0.03, 10)
      expect(loan.rateBasis.cap?.premiumBps).toBeCloseTo(35, 6)
    }
  })

  it('leaves the loan uncapped when the toggle is off', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({ onSubmit })
    await fillMinimum(user)
    await user.click(screen.getByRole('button', { name: 'Add loan' }))

    const loan = onSubmit.mock.calls[0]![0]
    if (loan.rateBasis.kind === 'FLOATING') expect(loan.rateBasis.cap).toBeNull()
  })

  it('hides the cap fields until a cap is actually wanted', async () => {
    await renderForm({})

    expect(screen.queryByLabelText('Reference rate capped at')).toBeNull()
    expect(screen.getByLabelText('This loan has a rate cap')).toBeDefined()
  })

  it('says the ceiling applies before the margin, so a total-rate cap is not mis-entered', async () => {
    const user = userEvent.setup()
    await renderForm({})
    await user.click(screen.getByLabelText('This loan has a rate cap'))

    // The single most likely way to enter this wrong, given banks quote it both ways.
    expect(
      await screen.findByText(/caps the reference rate before your margin is added/),
    ).toBeDefined()
  })

  it('warns that the fee is charged whether or not the cap ever bites', async () => {
    const user = userEvent.setup()
    await renderForm({})
    await user.click(screen.getByLabelText('This loan has a rate cap'))

    expect(
      await screen.findByText(/charged for the whole capped period whether or not/),
    ).toBeDefined()
  })

  it('round-trips a capped loan through the edit form unchanged', async () => {
    const user = userEvent.setup()
    const original = floatingRateLoan({
      name: 'Capped',
      cap: { ceiling: 0.03, premiumBps: 35, from: yearMonth(2026, 9), until: yearMonth(2031, 9) },
    })
    const onSubmit = vi.fn<(loan: Loan) => void>()

    await renderForm({
      onSubmit,
      defaultValues: loanToDraft(original),
      submitLabel: 'Save changes',
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSubmit.mock.calls[0]![0]).toEqual(original)
  })
})
