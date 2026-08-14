import type { Loan } from '@/domain/loan'
import type { Money } from '@/domain/money'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLocale } from '@/app/providers/SettingsProvider'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { rampStep, SEQUENTIAL_RAMP } from '@/components/charts/palette'
import { Money as MoneyText } from '@/components/Money'
import { monthOf, yearOf } from '@/domain/dates'
import { toMajorUnits } from '@/domain/money'
import { formatMoney, formatPeriod } from '@/i18n/format'

/**
 * Interest paid, one cell per month.
 *
 * A grid because the question is comparative magnitude across two dimensions — year and
 * month — and a 300-point line answers it much worse. What it makes visible is the
 * *steps*: a rate reset shows up as a whole row changing shade at once, which no other
 * view here shows as plainly.
 *
 * Sequential ramp, one hue, light means near zero. A rainbow would imply the months are
 * different kinds of thing rather than different amounts of the same thing.
 */
interface Cell {
  readonly period: string
  readonly month: number
  readonly interest: Money
  readonly fraction: number
}

/** Every other month gets a label; twelve would collide at 24px per cell. */
const MONTH_LABEL_INDEX = new Set([0, 2, 4, 6, 8, 10])

export function InterestHeatmap({
  loan,
  rows,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
}) {
  const { t } = useTranslation('charts')
  const locale = useLocale()
  const [hovered, setHovered] = useState<Cell | null>(null)

  const { years, cells, peak } = useMemo(() => {
    const byYear = new Map<number, Map<number, Cell>>()
    let highest = 0

    for (const row of rows) {
      const value = toMajorUnits(row.interest)
      if (value > highest) highest = value
    }

    for (const row of rows) {
      const year = yearOf(row.period)
      const month = monthOf(row.period)
      const months = byYear.get(year) ?? new Map<number, Cell>()

      months.set(month, {
        period: row.period,
        month,
        interest: row.interest,
        fraction: highest === 0 ? 0 : toMajorUnits(row.interest) / highest,
      })
      byYear.set(year, months)
    }

    return {
      years: [...byYear.keys()].toSorted((a, b) => a - b),
      cells: byYear,
      peak: highest,
    }
  }, [rows])

  if (years.length === 0 || peak === 0) return null

  return (
    <ChartFrame
      title={t('interestHeatmap.title')}
      description={t('interestHeatmap.description')}
      controls={<ScaleLegend low={t('interestHeatmap.low')} high={t('interestHeatmap.high')} />}
    >
      <div className="space-y-2">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-xs">
            <caption className="sr-only">{t('interestHeatmap.title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="sr-only">
                  {t('axis.year')}
                </th>
                {Array.from({ length: 12 }, (_, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="w-6 pb-1 text-center font-normal text-muted-foreground"
                  >
                    {MONTH_LABEL_INDEX.has(index)
                      ? formatPeriod(
                          `2026-${String(index + 1).padStart(2, '0')}` as never,
                          locale,
                          'short',
                        ).slice(0, 1)
                      : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year}>
                  <th
                    scope="row"
                    className="tabular pr-2 text-right font-normal text-muted-foreground"
                  >
                    {year}
                  </th>
                  {Array.from({ length: 12 }, (_, index) => {
                    const cell = cells.get(year)?.get(index + 1)
                    return (
                      <td key={index} className="p-0">
                        {cell === undefined ? (
                          <div className="size-6 rounded-sm bg-muted/40" />
                        ) : (
                          <button
                            type="button"
                            // The mark is the hit target, and it is 24px — big enough to
                            // aim at, and focusable so the value is reachable by keyboard.
                            className="size-6 rounded-sm transition-[outline] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                            style={{ backgroundColor: rampStep(SEQUENTIAL_RAMP, cell.fraction) }}
                            onPointerEnter={() => setHovered(cell)}
                            onPointerLeave={() => setHovered(null)}
                            onFocus={() => setHovered(cell)}
                            onBlur={() => setHovered(null)}
                            aria-label={`${formatPeriod(cell.period as never, locale, 'long')}: ${formatMoney(cell.interest, loan.currency, locale)}`}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/*
         * A fixed readout rather than a floating tooltip. With 24px cells a positioned
         * tooltip covers its neighbours, which is exactly what a reader is comparing
         * against — and the same details appear on keyboard focus.
         */}
        <div className="min-h-16" aria-live="polite">
          {hovered === null ? (
            <p className="text-xs text-muted-foreground">{t('interestHeatmap.hint')}</p>
          ) : (
            <ChartTooltip
              heading={formatPeriod(hovered.period as never, locale, 'long')}
              rows={[
                {
                  label: t('capitalVsInterest.interest'),
                  value: <MoneyText amount={hovered.interest} currency={loan.currency} />,
                },
              ]}
            />
          )}
        </div>
      </div>
    </ChartFrame>
  )
}

/** The scale legend a sequential encoding always needs. */
function ScaleLegend({ low, high }: { readonly low: string; readonly high: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{low}</span>
      <span aria-hidden className="flex gap-px">
        {SEQUENTIAL_RAMP.map((step) => (
          <span key={step} className="size-3 rounded-sm" style={{ backgroundColor: step }} />
        ))}
      </span>
      <span>{high}</span>
    </div>
  )
}
