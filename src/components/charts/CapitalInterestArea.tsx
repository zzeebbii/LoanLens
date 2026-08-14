import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useLocale } from '@/app/providers/SettingsProvider'
import { ChartDataTable } from '@/components/charts/ChartDataTable'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { thin, toScheduleData, yearTicks, type ScheduleDatum } from '@/components/charts/data'
import { CHROME, MARKS, SERIES } from '@/components/charts/palette'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { crossoverPeriod } from '@/domain/analytics'
import { formatAxisMoney, formatPeriod } from '@/i18n/format'

/**
 * Where each instalment goes, month by month.
 *
 * Stacked because the two bands are parts of one whole — the instalment — and the
 * question is how the split moves. The crossover, where capital first exceeds interest,
 * is the single most surprising fact in an amortization schedule, so it is marked rather
 * than left for the reader to find.
 *
 * Interest is the *lower* band deliberately: it is the part that shrinks, and anchoring
 * it to the axis makes the shrinking legible as the band closing rather than as a shape
 * sliding upward.
 */
const MAX_PLOTTED_POINTS = 180

export function CapitalInterestArea({
  loan,
  rows,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
}) {
  const { t } = useTranslation('charts')
  const locale = useLocale()

  const data = useMemo(() => toScheduleData(rows), [rows])
  const plotted = useMemo(() => thin(data, MAX_PLOTTED_POINTS), [data])
  const ticks = useMemo(() => yearTicks(plotted), [plotted])
  const crossover = useMemo(() => crossoverPeriod(rows), [rows])

  const hasFees = data.some((datum) => datum.fees > 0)

  const legend = [
    { label: t('capitalVsInterest.capital'), colour: SERIES.capital, shape: 'rect' as const },
    { label: t('capitalVsInterest.interest'), colour: SERIES.interest, shape: 'rect' as const },
    ...(hasFees
      ? [{ label: t('capitalVsInterest.fees'), colour: SERIES.fees, shape: 'rect' as const }]
      : []),
  ]

  return (
    <ChartFrame
      title={t('capitalVsInterest.title')}
      description={
        crossover === null
          ? t('capitalVsInterest.description')
          : `${t('capitalVsInterest.description')} ${t('crossoverNote', {
              period: formatPeriod(crossover, locale, 'short'),
            })}`
      }
      legend={legend}
      table={() => (
        <ChartDataTable
          title={t('capitalVsInterest.title')}
          rows={data}
          rowKey={(datum) => datum.period}
          columns={[
            {
              header: t('axis.period'),
              cell: (datum) => <Period period={datum.period} format="short" />,
            },
            {
              header: t('capitalVsInterest.interest'),
              align: 'right',
              cell: (datum) => (
                <Money amount={datum.exact.interest} currency={loan.currency} withoutSymbol />
              ),
            },
            {
              header: t('capitalVsInterest.capital'),
              align: 'right',
              cell: (datum) => (
                <Money amount={datum.exact.capital} currency={loan.currency} withoutSymbol />
              ),
            },
            {
              header: t('capitalVsInterest.fees'),
              align: 'right',
              cell: (datum) => (
                <Money amount={datum.exact.fees} currency={loan.currency} withoutSymbol />
              ),
            },
          ]}
        />
      )}
    >
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={plotted} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          {/* Horizontal only: vertical rules add ink without helping read a value. */}
          <CartesianGrid stroke={CHROME.grid} strokeWidth={1} vertical={false} />

          <XAxis
            dataKey="period"
            ticks={ticks}
            tickFormatter={(period: string) => String(new Date(`${period}-01`).getUTCFullYear())}
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
            width={56}
            tickFormatter={(value: number) => formatAxisMoney(value, loan.currency, locale)}
          />

          <Tooltip
            content={({ active, payload, label }) =>
              active === true && payload !== undefined && payload.length > 0 ? (
                <ScheduleTooltip
                  period={String(label)}
                  datum={payload[0]?.payload as ScheduleDatum}
                  currency={loan.currency}
                  labels={{
                    interest: t('capitalVsInterest.interest'),
                    capital: t('capitalVsInterest.capital'),
                    fees: t('capitalVsInterest.fees'),
                  }}
                  showFees={hasFees}
                />
              ) : null
            }
            // A hairline crosshair: the reader aims at a month, not at a 2px mark.
            cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
          />

          <Area
            type="monotone"
            dataKey="interest"
            stackId="payment"
            stroke={SERIES.interest}
            strokeWidth={MARKS.lineWidth}
            fill={SERIES.interest}
            fillOpacity={MARKS.areaOpacity}
            activeDot={{
              r: MARKS.activeDotRadius,
              strokeWidth: MARKS.ringWidth,
              stroke: CHROME.surface,
            }}
          />
          <Area
            type="monotone"
            dataKey="capital"
            stackId="payment"
            stroke={SERIES.capital}
            strokeWidth={MARKS.lineWidth}
            fill={SERIES.capital}
            fillOpacity={MARKS.areaOpacity}
            activeDot={{
              r: MARKS.activeDotRadius,
              strokeWidth: MARKS.ringWidth,
              stroke: CHROME.surface,
            }}
          />
          {hasFees && (
            <Area
              type="monotone"
              dataKey="fees"
              stackId="payment"
              stroke={SERIES.fees}
              strokeWidth={MARKS.lineWidth}
              fill={SERIES.fees}
              fillOpacity={MARKS.areaOpacity}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function ScheduleTooltip({
  period,
  datum,
  currency,
  labels,
  showFees,
}: {
  readonly period: string
  readonly datum: ScheduleDatum | undefined
  readonly currency: string
  readonly labels: { interest: string; capital: string; fees: string }
  readonly showFees: boolean
}) {
  const locale = useLocale()
  if (datum === undefined) return null

  return (
    <ChartTooltip
      heading={formatPeriod(datum.period, locale, 'long')}
      rows={[
        {
          label: labels.capital,
          colour: SERIES.capital,
          value: <Money amount={datum.exact.capital} currency={currency} />,
        },
        {
          label: labels.interest,
          colour: SERIES.interest,
          value: <Money amount={datum.exact.interest} currency={currency} />,
        },
        ...(showFees
          ? [
              {
                label: labels.fees,
                colour: SERIES.fees,
                value: <Money amount={datum.exact.fees} currency={currency} />,
              },
            ]
          : []),
      ]}
      footer={period === datum.period ? undefined : period}
    />
  )
}
