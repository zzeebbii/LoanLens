// @vitest-environment jsdom

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/app/testing/renderApp'
import { DateField } from '@/components/fields/DateField'
import { MonthField } from '@/components/fields/MonthField'
import { SwitchField } from '@/components/fields/SwitchField'

/**
 * These fields replaced `type="date"` and `type="month"`.
 *
 * The native controls worked but rendered the browser's own widget, which ignores the app's
 * styling entirely — and `type="month"` is not implemented at all in some browsers, where it
 * silently degrades to a bare text box.
 *
 * What matters in these tests is the *value contract*: whatever the reader does, the field
 * emits an ISO string the domain can parse. A picker that produced a subtly different format
 * would be worse than the native control it replaced.
 */
/**
 * The calendar is a lazily-imported chunk, so the first `findByRole('grid')` is really
 * waiting on a dynamic import rather than on a render. On a loaded CI runner that import has
 * overrun the default one-second `findBy` window and failed the suite.
 *
 * Importing the module once here means React's `lazy` resolves from the module cache instead
 * of racing the clock. Raising the timeout instead would have hidden the variance rather than
 * removed it, and left the same failure waiting for a slower machine.
 */
beforeAll(async () => {
  await import('@/components/ui/calendar')
})

describe('DateField', () => {
  it('accepts a typed date, because a drawdown is often years back', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: string) => void>()

    await renderWithProviders(<DateField value="" onChange={onChange} />)

    await user.type(screen.getByRole('textbox'), '2021-02-15')

    // Typed straight through, one character at a time, with no reformatting in between.
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)?.[0]).toBe('5')
  })

  it('emits an ISO date when a day is picked from the calendar', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: string) => void>()

    await renderWithProviders(<DateField value="2021-02-15" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Open the calendar' }))

    const grid = await screen.findByRole('grid')
    // Matched by the number on the cell — what a reader sees and aims at. The button's
    // accessible name is the full written-out date, which is right for a screen reader but
    // is not what a sighted user is clicking.
    await user.click(within(grid).getByText('20'))

    expect(onChange).toHaveBeenCalledWith('2021-02-20')
  })

  it('opens the calendar on the month the field already holds', async () => {
    const user = userEvent.setup()

    await renderWithProviders(<DateField value="2021-02-15" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Open the calendar' }))

    // Not today's month: reaching February 2021 by arrow would be forty clicks.
    expect(await screen.findByText('February 2021')).toBeDefined()
  })

  it('shows the date written out, so a typo is visible before it is saved', async () => {
    const user = userEvent.setup()

    await renderWithProviders(<DateField value="2021-02-15" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Open the calendar' }))

    expect(await screen.findByText(/15 February 2021|February 15, 2021/)).toBeDefined()
  })

  it('copes with a half-typed value without throwing', async () => {
    const user = userEvent.setup()

    await renderWithProviders(<DateField value="2021-0" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Open the calendar' }))

    // The calendar still opens; it simply has nothing selected.
    expect(await screen.findByRole('grid')).toBeDefined()
  })

  it('is a text input, not the browser widget it replaced', async () => {
    await renderWithProviders(<DateField value="2021-02-15" onChange={vi.fn()} />)

    const input = screen.getByRole('textbox')
    expect(input.getAttribute('type')).toBe('text')
  })
})

describe('MonthField', () => {
  const labels = { monthLabel: 'Month', yearLabel: 'Year' }

  it('emits YYYY-MM when the month changes, keeping the year', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: string) => void>()

    await renderWithProviders(<MonthField value="2021-03" onChange={onChange} {...labels} />)

    await user.click(screen.getByRole('combobox', { name: 'Month' }))
    await user.click(await screen.findByRole('option', { name: 'September' }))

    expect(onChange).toHaveBeenCalledWith('2021-09')
  })

  it('emits YYYY-MM when the year changes, keeping the month', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: string) => void>()

    await renderWithProviders(<MonthField value="2021-03" onChange={onChange} {...labels} />)

    await user.click(screen.getByRole('combobox', { name: 'Year' }))
    await user.click(await screen.findByRole('option', { name: '2024' }))

    expect(onChange).toHaveBeenCalledWith('2024-03')
  })

  it('zero-pads the month, since the domain sorts these as strings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: string) => void>()

    await renderWithProviders(<MonthField value="2021-11" onChange={onChange} {...labels} />)

    await user.click(screen.getByRole('combobox', { name: 'Month' }))
    await user.click(await screen.findByRole('option', { name: 'March' }))

    // '2021-3' would break the lexicographic ordering the whole domain relies on.
    expect(onChange).toHaveBeenCalledWith('2021-03')
  })

  it('shows the month it currently holds', async () => {
    await renderWithProviders(<MonthField value="2021-03" onChange={vi.fn()} {...labels} />)

    expect(screen.getByRole('combobox', { name: 'Month' }).textContent).toBe('March')
    expect(screen.getByRole('combobox', { name: 'Year' }).textContent).toBe('2021')
  })

  it('names both selects, so neither is an unlabelled control', async () => {
    await renderWithProviders(<MonthField value="2021-03" onChange={vi.fn()} {...labels} />)

    expect(screen.getByRole('combobox', { name: 'Month' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeDefined()
  })
})

/**
 * The toggle rows.
 *
 * jsdom has no layout, so the alignment that prompted this component cannot be asserted here —
 * only the class contract that produces it, plus the behaviour that would break if someone
 * "simplified" the markup and dropped the `htmlFor`/`id` pairing along with it.
 */
describe('SwitchField', () => {
  it('lets the label operate the switch, not just sit beside it', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn<(checked: boolean) => void>()

    await renderWithProviders(
      <SwitchField
        id="cap"
        checked={false}
        onCheckedChange={onCheckedChange}
        label="This loan has a rate cap"
        description="The bank charges for it."
      />,
    )

    await user.click(screen.getByText('This loan has a rate cap'))

    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('gives the label a box the same height as the switch', async () => {
    await renderWithProviders(
      <SwitchField id="cap" checked={false} onCheckedChange={vi.fn()} label="Capped" />,
    )

    // The bug this replaced: an inline label inherits the wrapping block's 1.5 line height
    // rather than its own, so its text sits a couple of pixels below a top-aligned switch.
    // `block` plus an explicit `leading-5` is what makes the two boxes agree.
    const label = screen.getByText('Capped')
    expect(label.className).toContain('block')
    expect(label.className).toContain('leading-5')
  })

  it('omits the description entirely when there is none, rather than leaving a gap', async () => {
    const { container } = await renderWithProviders(
      <SwitchField id="cap" checked={false} onCheckedChange={vi.fn()} label="Capped" />,
    )

    expect(container.querySelector('p')).toBeNull()
  })

  it('reflects the checked state, so the control is not merely decorative', async () => {
    await renderWithProviders(
      <SwitchField id="cap" checked onCheckedChange={vi.fn()} label="Capped" />,
    )

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })
})
