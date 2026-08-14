// @vitest-environment jsdom

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/app/testing/renderApp'
import { CapitalInterestArea } from '@/components/charts/CapitalInterestArea'
import { thin, toScheduleData } from '@/components/charts/data'
import { InterestHeatmap } from '@/components/charts/InterestHeatmap'
import { KpiTiles } from '@/components/charts/KpiTiles'
import { LifetimeSplit } from '@/components/charts/LifetimeSplit'
import { rampStep, SEQUENTIAL_RAMP, SERIES } from '@/components/charts/palette'
import { PaymentAnatomy } from '@/components/charts/PaymentAnatomy'
import { RateHistoryLine } from '@/components/charts/RateHistoryLine'
import { YearlyBars } from '@/components/charts/YearlyBars'
import { totals } from '@/domain/analytics'
import { yearMonth } from '@/domain/dates'
import { toCents } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { fixedRateLoan, floatingRateLoan, noRates, rateOf } from '@/domain/testing/fixtures'

/**
 * What these check, and what they cannot.
 *
 * jsdom has no layout, so a Recharts `ResponsiveContainer` measures zero and draws nothing.
 * The SVG geometry is therefore untestable here — and largely untestable anywhere without a
 * real browser, which is why the design guidance says to render and look at it.
 *
 * What *is* testable is the contract that makes a chart usable, and it is the part most
 * likely to be quietly dropped: a legend whenever there are two or more series, a table view
 * carrying every value a tooltip would show, and an accessible name. Those are assertions
 * worth having, because one of the palette's hues sits below 3:1 on the light surface and
 * this relief is what makes it acceptable.
 */
const loan = fixedRateLoan()
const rows = replay({ loan, referenceRateAt: noRates })
const summary = totals(rows)

describe('every chart carries its accessibility contract', () => {
  it('names the region so it is not an anonymous graphic', async () => {
    const { container } = await renderWithProviders(<CapitalInterestArea loan={loan} rows={rows} />)

    const caption = container.querySelector('figcaption')
    expect(caption?.textContent).toContain('Where each instalment goes')
  })

  it('shows a legend when there are two or more series', async () => {
    await renderWithProviders(<CapitalInterestArea loan={loan} rows={rows} />)

    expect(await screen.findByText('Capital')).toBeDefined()
    expect(screen.getByText('Interest')).toBeDefined()
  })

  it('offers a table view, and it holds the real figures', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<CapitalInterestArea loan={loan} rows={rows} />)

    await user.click(screen.getByRole('button', { name: /Show as a table/ }))

    const table = await screen.findByRole('table')
    // 708.33 is the first month's interest in the reference schedule.
    expect(within(table).getByText('708.33')).toBeDefined()
  })

  it('keeps the table collapsed until asked for, so it costs nothing', async () => {
    await renderWithProviders(<CapitalInterestArea loan={loan} rows={rows} />)
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('LifetimeSplit', () => {
  it('leads with the ratio as a hero figure rather than a two-slice pie', async () => {
    const { container } = await renderWithProviders(<LifetimeSplit loan={loan} totals={summary} />)

    // 121,457.49 of interest on 250,000 borrowed is 48.6%.
    expect(await screen.findByText('48.6%')).toBeDefined()
    // No pie: the shape is one labelled bar.
    expect(container.querySelector('svg')).toBeNull()
  })

  it('describes the bar for a screen reader instead of leaving empty divs', async () => {
    await renderWithProviders(<LifetimeSplit loan={loan} totals={summary} />)

    const bar = await screen.findByRole('img')
    expect(bar.getAttribute('aria-label')).toContain('Amount borrowed')
  })
})

describe('YearlyBars', () => {
  it('rolls up to one row per calendar year', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<YearlyBars loan={loan} rows={rows} />)

    await user.click(screen.getByRole('button', { name: /Show as a table/ }))
    const table = await screen.findByRole('table')

    // 2021 through 2046 inclusive.
    expect(within(table).getByText('2021')).toBeDefined()
    expect(within(table).getByText('2046')).toBeDefined()
    expect(within(table).queryByText('2047')).toBeNull()
  })
})

describe('PaymentAnatomy', () => {
  it('breaks one instalment into its parts, with each part labelled', async () => {
    await renderWithProviders(<PaymentAnatomy loan={loan} rows={rows} />)

    const bar = await screen.findByRole('img')
    // Values live beside the bar, never clipped inside a narrow segment.
    expect(bar.getAttribute('aria-label')).toMatch(/Capital/)
    expect(bar.getAttribute('aria-label')).toMatch(/Interest/)
  })

  it('lets the reader choose which month to open', async () => {
    await renderWithProviders(<PaymentAnatomy loan={loan} rows={rows} />)
    expect(await screen.findByRole('combobox')).toBeDefined()
  })
})

describe('InterestHeatmap', () => {
  it('makes every cell focusable, so values are reachable without a pointer', async () => {
    await renderWithProviders(<InterestHeatmap loan={loan} rows={rows} />)

    const cells = await screen.findAllByRole('button')
    expect(cells.length).toBeGreaterThan(200)
    // Each cell names its month and amount rather than relying on the tooltip.
    expect(cells[0]?.getAttribute('aria-label')).toMatch(/2021/)
  })

  it('ships a scale legend, which a sequential encoding always needs', async () => {
    await renderWithProviders(<InterestHeatmap loan={loan} rows={rows} />)

    expect(await screen.findByText('Less')).toBeDefined()
    expect(screen.getByText('More')).toBeDefined()
  })
})

describe('KpiTiles', () => {
  it('shows single numbers as tiles rather than as one-bar charts', async () => {
    await renderWithProviders(<KpiTiles loan={loan} rows={rows} totals={summary} />)

    expect(await screen.findByText('Total interest')).toBeDefined()
    expect(screen.getByText('€121,457')).toBeDefined()
  })

  it('marks the sparkline as decoration, since the number above it is the content', async () => {
    const { container } = await renderWithProviders(
      <KpiTiles loan={loan} rows={rows} totals={summary} />,
    )

    const sparklines = container.querySelectorAll('svg')
    expect(sparklines.length).toBeGreaterThan(0)
    for (const sparkline of sparklines) {
      expect(sparkline.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

describe('RateHistoryLine', () => {
  // Rates climb through the cap, so the ceiling both binds and is visibly exceeded.
  const rising = rateOf({ '2021-01': 0, '2022-01': 0.005, '2023-01': 0.032, '2024-01': 0.042 })
  const capped = floatingRateLoan({
    cap: { ceiling: 0.03, premiumBps: 35, from: yearMonth(2021, 3), until: yearMonth(2031, 3) },
  })

  it('does not draw a ceiling for a loan that has no cap', async () => {
    const uncapped = floatingRateLoan()
    await renderWithProviders(
      <RateHistoryLine
        loan={uncapped}
        rows={replay({ loan: uncapped, referenceRateAt: rising })}
      />,
    )

    expect(await screen.findByText('Reference rate')).toBeDefined()
    expect(screen.queryByText('Cap ceiling')).toBeNull()
  })

  it('adds the ceiling to the legend when a cap is in force', async () => {
    await renderWithProviders(
      <RateHistoryLine loan={capped} rows={replay({ loan: capped, referenceRateAt: rising })} />,
    )

    expect(await screen.findByText('Cap ceiling')).toBeDefined()
  })

  it('carries the ceiling into the table view, where the geometry is unavailable', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <RateHistoryLine loan={capped} rows={replay({ loan: capped, referenceRateAt: rising })} />,
    )

    await user.click(screen.getByRole('button', { name: /Show as a table/ }))
    const table = await screen.findByRole('table')

    expect(within(table).getAllByRole('columnheader').at(-1)?.textContent).toBe('Cap ceiling')
    // The ceiling as entered, not the rate it produced — the margin is not in this figure.
    expect(within(table).getAllByText(/3\.000\s?%/).length).toBeGreaterThan(0)
  })

  it('reports the raw fixing beside the ceiling, so the gap is the protection', async () => {
    const cappedRows = replay({ loan: capped, referenceRateAt: rising })
    const boundRows = cappedRows.filter((row) => row.flags.includes('RATE_CAPPED'))

    expect(boundRows.length).toBeGreaterThan(0)
    // Every capped month plots a raw fixing above its ceiling. That vertical gap is the
    // whole visual argument for the cap, so it must never be the clamped figure.
    for (const row of boundRows) {
      expect(row.referenceRate).not.toBeNull()
      expect(row.referenceRate!).toBeGreaterThan(row.capCeiling!)
      expect(row.capCeiling).toBeCloseTo(0.03, 10)
    }

    // The 2024 reset reads a 4.2% fixing: 1.2 points of visible daylight above the lid.
    expect(cappedRows.find((row) => row.period === '2024-03')?.referenceRate).toBeCloseTo(0.042, 10)
  })
})

describe('the chart palette', () => {
  it('resolves every role to a token, never to a hex', () => {
    // A hex here would be a colour that escaped the validator and would not swap in dark
    // mode, where the palette is a different selected set rather than a lightened one.
    for (const colour of Object.values(SERIES)) {
      expect(colour).toMatch(/^var\(--[\w-]+\)$/)
    }
    for (const step of SEQUENTIAL_RAMP) {
      expect(step).toMatch(/^var\(--[\w-]+\)$/)
    }
  })

  it('maps a fraction onto the ramp, clamping rather than wrapping', () => {
    expect(rampStep(SEQUENTIAL_RAMP, 0)).toBe(SEQUENTIAL_RAMP[0])
    expect(rampStep(SEQUENTIAL_RAMP, 1)).toBe(SEQUENTIAL_RAMP.at(-1))
    // Wrapping would paint the largest magnitude as the palest step.
    expect(rampStep(SEQUENTIAL_RAMP, 1.5)).toBe(SEQUENTIAL_RAMP.at(-1))
    expect(rampStep(SEQUENTIAL_RAMP, -1)).toBe(SEQUENTIAL_RAMP[0])
  })
})

describe('chart data adapters', () => {
  it('keeps the exact amount beside the plotted number', () => {
    const data = toScheduleData(rows)

    // The float is for geometry; the Money is what a reader sees.
    expect(data[0]?.interest).toBeCloseTo(708.33, 6)
    expect(toCents(data[0]!.exact.interest)).toBe(70_833n)
  })

  it('folds the overpayment into capital, since both retire principal', () => {
    const withExtra = replay({
      loan,
      referenceRateAt: noRates,
      events: [
        {
          kind: 'EXTRA_PAYMENT',
          period: rows[0]!.period,
          amount: rows[0]!.capital,
          effect: 'SHORTEN_TERM',
        },
      ],
    })
    const data = toScheduleData(withExtra)

    expect(toCents(data[0]!.exact.capital)).toBe(toCents(rows[0]!.capital) * 2n)
  })

  it('thins a long series without losing either endpoint', () => {
    const thinned = thin(rows, 60)

    expect(thinned).toHaveLength(60)
    expect(thinned[0]).toBe(rows[0])
    expect(thinned.at(-1)).toBe(rows.at(-1))
  })

  it('leaves a short series untouched', () => {
    expect(thin(rows.slice(0, 10), 60)).toHaveLength(10)
  })
})
