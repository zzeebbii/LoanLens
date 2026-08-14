import type { YearMonth } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useLocale } from '@/app/providers/SettingsProvider'
import { ChartDataTable } from '@/components/charts/ChartDataTable'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { thin } from '@/components/charts/data'
import { CHROME, MARKS, SERIES } from '@/components/charts/palette'
import { Period } from '@/components/Period'
import { Rate } from '@/components/Rate'
import { formatPeriod, formatRate } from '@/i18n/format'

/**
 * The reference rate and the rate actually charged.
 *
 * Two series on **one** axis — both are rates, so they share a scale honestly. The gap
 * between them is the margin, and seeing it as a constant band is the point: it makes
 * visible that a falling reference does not fall all the way to what you pay.
 *
 * Reset months are marked with hairlines rather than a third series. They are annotations
 * on the x-axis, not a quantity, and drawing them as a series would imply they had values.
 *
 * A cap ceiling, when there is one, is a third line — but only across the months it covers,
 * and dashed. Both of those are deliberate. Drawn across the full width it would claim
 * protection in years the loan does not have any; drawn solid it would read as a third
 * measurement rather than as the lid the reference line is pressed against. The reference
 * series plots the *raw* fixing, so where it rises above this line is precisely what the cap
 * is buying.
 */
const MAX_PLOTTED_POINTS = 200

/**
 * Which note belongs under the tooltip.
 *
 * A month where the ceiling actually bit is the more interesting of the two facts, so it
 * wins when both are true — a reset that was immediately capped is, from the borrower's side,
 * a month where the cap earned its fee.
 */
function footerKeyFor(row: PaymentRow): 'rateHistory.cappedHere' | 'rateHistory.resetHere' | null {
  if (row.flags.includes('RATE_CAPPED')) return 'rateHistory.cappedHere'
  if (row.flags.includes('RATE_RESET')) return 'rateHistory.resetHere'
  return null
}

export function RateHistoryLine({
  loan,
  rows,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
}) {
  const { t } = useTranslation('charts')
  const locale = useLocale()

  const data = useMemo(
    () =>
      rows.map((row) => ({
        period: row.period,
        applied: row.annualRate * 100,
        reference: row.referenceRate === null ? undefined : row.referenceRate * 100,
        // `undefined` outside the capped months, so the line simply stops there.
        ceiling: row.capCeiling === null ? undefined : row.capCeiling * 100,
        row,
      })),
    [rows],
  )

  const plotted = useMemo(() => thin(data, MAX_PLOTTED_POINTS), [data])
  const hasReference = data.some((datum) => datum.reference !== undefined)
  const hasCeiling = data.some((datum) => datum.ceiling !== undefined)

  const resets = useMemo(
    () => rows.filter((row) => row.flags.includes('RATE_RESET')).map((row) => row.period),
    [rows],
  )

  const ticks = useMemo(() => {
    const years: YearMonth[] = []
    let lastYear: string | null = null
    for (const datum of plotted) {
      const year = datum.period.slice(0, 4)
      if (year !== lastYear) {
        years.push(datum.period)
        lastYear = year
      }
    }
    return years.length <= 8 ? years : thin(years, 8)
  }, [plotted])

  return (
    <ChartFrame
      title={t('rateHistory.title')}
      description={t('rateHistory.description')}
      legend={[
        { label: t('rateHistory.applied'), colour: SERIES.capital, shape: 'line' },
        ...(hasReference
          ? [{ label: t('rateHistory.reference'), colour: SERIES.baseline, shape: 'line' as const }]
          : []),
        ...(hasCeiling
          ? [
              {
                label: t('rateHistory.ceiling'),
                colour: SERIES.alternative,
                shape: 'dashed' as const,
              },
            ]
          : []),
      ]}
      table={() => (
        <ChartDataTable
          title={t('rateHistory.title')}
          // Only the resets carry new information; every month between repeats the last.
          rows={rows.filter((row) => row.flags.includes('RATE_RESET') || row.index === 1)}
          rowKey={(row) => row.period}
          columns={[
            {
              header: t('axis.period'),
              cell: (row) => <Period period={row.period} format="short" />,
            },
            {
              header: t('rateHistory.reference'),
              align: 'right',
              cell: (row) =>
                row.referenceRate === null ? '—' : <Rate value={row.referenceRate} />,
            },
            {
              header: t('rateHistory.applied'),
              align: 'right',
              cell: (row) => <Rate value={row.annualRate} />,
            },
            ...(hasCeiling
              ? [
                  {
                    header: t('rateHistory.ceiling'),
                    align: 'right' as const,
                    cell: (row: PaymentRow) =>
                      row.capCeiling === null ? '—' : <Rate value={row.capCeiling} />,
                  },
                ]
              : []),
          ]}
        />
      )}
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={plotted} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHROME.grid} strokeWidth={1} vertical={false} />

          <XAxis
            dataKey="period"
            ticks={ticks}
            tickFormatter={(period: string) => period.slice(0, 4)}
            stroke={CHROME.axis}
            tick={{ fontSize: 11, fill: CHROME.axis }}
            tickLine={false}
            axisLine={{ stroke: CHROME.grid }}
            minTickGap={16}
          />
          <YAxis
            stroke={CHROME.axis}
            tick={{ fontSize: 11, fill: CHROME.axis }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => formatRate(value / 100, locale, 1)}
          />

          {/* Reset months as recessive hairlines: annotations, not data. */}
          {resets.map((period) => (
            <ReferenceLine key={period} x={period} stroke={CHROME.grid} strokeWidth={1} />
          ))}

          <Tooltip
            cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const datum = payload?.[0]?.payload as
                | { period: YearMonth; row: PaymentRow }
                | undefined
              return active === true && datum !== undefined ? (
                <ChartTooltip
                  heading={formatPeriod(datum.period, locale, 'long')}
                  rows={[
                    {
                      label: t('rateHistory.applied'),
                      colour: SERIES.capital,
                      value: <Rate value={datum.row.annualRate} />,
                    },
                    ...(datum.row.referenceRate === null
                      ? []
                      : [
                          {
                            label: t('rateHistory.reference'),
                            colour: SERIES.baseline,
                            value: <Rate value={datum.row.referenceRate} />,
                          },
                        ]),
                    ...(datum.row.capCeiling === null
                      ? []
                      : [
                          {
                            label: t('rateHistory.ceiling'),
                            colour: SERIES.alternative,
                            value: <Rate value={datum.row.capCeiling} />,
                          },
                        ]),
                  ]}
                  footer={(() => {
                    const key = footerKeyFor(datum.row)
                    return key === null ? undefined : t(key)
                  })()}
                />
              ) : null
            }}
          />

          {hasCeiling && (
            <Line
              type="stepAfter"
              dataKey="ceiling"
              stroke={SERIES.alternative}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {hasReference && (
            <Line
              type="stepAfter"
              dataKey="reference"
              stroke={SERIES.baseline}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {/*
           * `stepAfter`, not a curve: the applied rate is held constant between resets and
           * then jumps. A smoothed line would draw a gradual change that never happened.
           */}
          <Line
            type="stepAfter"
            dataKey="applied"
            stroke={SERIES.capital}
            strokeWidth={MARKS.lineWidth}
            strokeLinecap="round"
            dot={false}
            activeDot={{
              r: MARKS.activeDotRadius,
              strokeWidth: MARKS.ringWidth,
              stroke: CHROME.surface,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-muted-foreground">{t('rateHistory.marginNote')}</p>
      <span className="sr-only">{loan.name}</span>
    </ChartFrame>
  )
}
