import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useLocale } from '@/app/providers/SettingsProvider'
import { ChartDataTable } from '@/components/charts/ChartDataTable'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { CHROME, MARKS, SERIES } from '@/components/charts/palette'
import { Money } from '@/components/Money'
import { byYear, type YearSummary } from '@/domain/analytics'
import { isPositive, toMajorUnits } from '@/domain/money'
import { formatAxisMoney } from '@/i18n/format'

/**
 * What each calendar year cost, split into interest and capital.
 *
 * Twenty-five columns instead of three hundred: a year is the unit people think in when
 * they ask what the loan is costing them, and the shift from interest-heavy to
 * capital-heavy is far more legible at this resolution than month by month.
 *
 * Stacked rather than grouped because the two parts sum to something meaningful — what was
 * paid that year — and the total is worth being able to read off the column height.
 */
export function YearlyBars({
  loan,
  rows,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
}) {
  const { t } = useTranslation('charts')
  const locale = useLocale()

  const years = useMemo(() => byYear(rows), [rows])
  const hasFees = years.some((year) => isPositive(year.fees))

  const data = useMemo(
    () =>
      years.map((year) => ({
        year: year.year,
        interest: toMajorUnits(year.interest),
        capital: toMajorUnits(year.capital),
        fees: toMajorUnits(year.fees),
        summary: year,
      })),
    [years],
  )

  return (
    <ChartFrame
      title={t('byYear.title')}
      description={t('byYear.description')}
      legend={[
        { label: t('capitalVsInterest.capital'), colour: SERIES.capital },
        { label: t('capitalVsInterest.interest'), colour: SERIES.interest },
        ...(hasFees ? [{ label: t('capitalVsInterest.fees'), colour: SERIES.fees }] : []),
      ]}
      table={() => (
        <ChartDataTable
          title={t('byYear.title')}
          rows={years}
          rowKey={(year) => String(year.year)}
          columns={[
            {
              header: t('axis.year'),
              cell: (year) => <span className="tabular">{year.year}</span>,
            },
            {
              header: t('capitalVsInterest.interest'),
              align: 'right',
              cell: (year) => <Money amount={year.interest} currency={loan.currency} />,
            },
            {
              header: t('capitalVsInterest.capital'),
              align: 'right',
              cell: (year) => <Money amount={year.capital} currency={loan.currency} />,
            },
            {
              header: t('capitalVsInterest.fees'),
              align: 'right',
              cell: (year) => <Money amount={year.fees} currency={loan.currency} />,
            },
          ]}
        />
      )}
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHROME.grid} strokeWidth={1} vertical={false} />

          <XAxis
            dataKey="year"
            stroke={CHROME.axis}
            tick={{ fontSize: 11, fill: CHROME.axis }}
            tickLine={false}
            axisLine={{ stroke: CHROME.grid }}
            minTickGap={12}
          />
          <YAxis
            stroke={CHROME.axis}
            tick={{ fontSize: 11, fill: CHROME.axis }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => formatAxisMoney(value, loan.currency, locale)}
          />

          <Tooltip
            // Bars are their own hit targets, so there is no crosshair; the hovered
            // column lifts instead.
            cursor={{ fill: 'var(--accent)', fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              const summary = (payload?.[0]?.payload as { summary?: YearSummary } | undefined)
                ?.summary
              return active === true && summary !== undefined ? (
                <ChartTooltip
                  heading={<span className="tabular">{summary.year}</span>}
                  rows={[
                    {
                      label: t('capitalVsInterest.capital'),
                      colour: SERIES.capital,
                      value: <Money amount={summary.capital} currency={loan.currency} whole />,
                    },
                    {
                      label: t('capitalVsInterest.interest'),
                      colour: SERIES.interest,
                      value: <Money amount={summary.interest} currency={loan.currency} whole />,
                    },
                    ...(hasFees
                      ? [
                          {
                            label: t('capitalVsInterest.fees'),
                            colour: SERIES.fees,
                            value: <Money amount={summary.fees} currency={loan.currency} whole />,
                          },
                        ]
                      : []),
                  ]}
                  footer={
                    <>
                      {t('byYear.total')}{' '}
                      <Money amount={summary.totalPaid} currency={loan.currency} whole />
                    </>
                  }
                />
              ) : null
            }}
          />

          {/*
           * `stackId` plus a 2px surface stroke gives the surface gap the spec calls for.
           * A stroke in the *surface* colour reads as a gap, not as a border around the
           * mark — which is the thing to avoid.
           */}
          <Bar
            dataKey="interest"
            stackId="year"
            fill={SERIES.interest}
            stroke={CHROME.surface}
            strokeWidth={MARKS.gap}
            maxBarSize={MARKS.maxBarWidth}
            isAnimationActive={false}
          />
          <Bar
            dataKey="capital"
            stackId="year"
            fill={SERIES.capital}
            stroke={CHROME.surface}
            strokeWidth={MARKS.gap}
            maxBarSize={MARKS.maxBarWidth}
            // Rounded only on the top of the stack: the data-end, square at the baseline.
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          {hasFees && (
            <Bar
              dataKey="fees"
              stackId="year"
              fill={SERIES.fees}
              stroke={CHROME.surface}
              strokeWidth={MARKS.gap}
              maxBarSize={MARKS.maxBarWidth}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
