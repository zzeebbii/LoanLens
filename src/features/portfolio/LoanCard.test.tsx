// @vitest-environment jsdom

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '@/app/testing/renderApp'
import { floatingRateLoan } from '@/domain/testing/fixtures'
import { InMemoryLoanRepository } from '@/persistence'

/**
 * Edit and delete on the card itself.
 *
 * The delete is the reason these are worth testing at length: it is irreversible, it now sits
 * one click away in a list rather than behind a navigation, and every card offers one. The
 * things that make that safe — a confirmation, and every control saying which loan it belongs
 * to — are invisible in a screenshot and easy to lose in a refactor.
 */
async function withLoans(...names: readonly string[]) {
  const repository = new InMemoryLoanRepository()
  for (const [index, name] of names.entries()) {
    await repository.saveLoan(floatingRateLoan({ id: `loan-${index}`, name }))
  }
  const rendered = await renderApp('/', { repository })
  // The route resolves before mount, but the loans themselves arrive through a query a tick
  // later. Waiting for the last one keeps every case below free of `findBy` noise.
  await screen.findByText(names.at(-1) ?? '')
  return rendered
}

function card(name: string) {
  const heading = screen.getByText(name)
  const element = heading.closest('[data-slot="card"]')
  if (element === null) throw new Error(`No card found for ${name}.`)
  return within(element as HTMLElement)
}

describe('LoanCard actions', () => {
  it('offers edit and delete without leaving the list', async () => {
    await withLoans('Mortgage')

    expect(card('Mortgage').getByRole('link', { name: 'Edit Mortgage' })).toBeDefined()
    expect(card('Mortgage').getByRole('button', { name: 'Delete Mortgage' })).toBeDefined()
  })

  it('names the loan in every control, so a list of cards is not a row of identical buttons', async () => {
    await withLoans('Mortgage', 'Summer house')

    // The failure this prevents: five buttons all called "Edit", and a screen-reader user
    // with no way to tell which loan they are about to change.
    expect(screen.getByRole('link', { name: 'Edit Summer house' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Delete Summer house' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Loan: Summer house' })).toBeDefined()
  })

  it('points edit at that loan, not at whichever card rendered first', async () => {
    await withLoans('Mortgage', 'Summer house')

    expect(screen.getByRole('link', { name: 'Edit Summer house' }).getAttribute('href')).toBe(
      '/loans/loan-1/edit',
    )
  })

  it('asks before deleting, and says which loan it would delete', async () => {
    const user = userEvent.setup()
    const { repository } = await withLoans('Mortgage', 'Summer house')

    await user.click(screen.getByRole('button', { name: 'Delete Summer house' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Summer house/)).toBeDefined()
    // Nothing has happened yet — the click opened a question, not a deletion.
    expect(await repository.listLoans()).toHaveLength(2)
  })

  it('deletes only the loan that was asked about', async () => {
    const user = userEvent.setup()
    const { repository } = await withLoans('Mortgage', 'Summer house')

    await user.click(screen.getByRole('button', { name: 'Delete Summer house' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    const remaining = await repository.listLoans()
    expect(remaining.map((loan) => loan.name)).toEqual(['Mortgage'])
  })

  it('leaves the loan alone when the confirmation is dismissed', async () => {
    const user = userEvent.setup()
    const { repository } = await withLoans('Mortgage')

    await user.click(screen.getByRole('button', { name: 'Delete Mortgage' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(await repository.listLoans()).toHaveLength(1)
  })

  it('stays on the list after deleting, rather than following the loan somewhere', async () => {
    const user = userEvent.setup()
    const { router } = await withLoans('Mortgage', 'Summer house')

    await user.click(screen.getByRole('button', { name: 'Delete Summer house' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(router.state.location.pathname).toBe('/')
  })
})
