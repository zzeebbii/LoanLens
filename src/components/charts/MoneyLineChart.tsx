import type { YearMonth } from '@/domain/dates'
import type { Money } from '@/domain/money'
import type { ReactNode } from 'react'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
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
import { CHROME, MARKS } from '@/components/charts/palette'
import { Money as MoneyText } from '@/components/Money'
import { Period } from '@/components/Period'
import { toMajorUnits } from '@/domain/money'
import { formatAxisMoney, formatPeriod } from '@/i18n/format'

/**
 * A money-over-time line chart with one to three series.
 *
 * One component rather than three because the balance curve, the
 * baseline-versus-scenario comparison, and the cumulative-outlay break-even chart are the
 * same picture with different inputs — and a reader who has learned to read one should not
 * have to learn the others. Sharing the component is what guarantees that.
 *
 * Capped at three series on purpose: three is the count the palette clears on every gate,
 * and any comparison needing four is really two charts.
 */
const MAX_PLOTTED_POINTS = 200

export interface MoneySeries {
  readonly id: string
  readonly label: string
  readonly colour: string
  /** Exact values by period. Geometry is derived; these are what a reader sees. */
  readonly points: ReadonlyMap<YearMonth, Money>
  /** Draw as context rather than as a subject — thinner, no end marker. */
  readonly muted?: boolean
}

export interface MoneyLineChartProps {
  readonly title: string
  readonly description?: string
  readonly currency: string
  /** Every period on the x-axis, ascending. Series may be sparse within it. */
  readonly periods: readonly YearMonth[]
  readonly series: readonly MoneySeries[]
  /** A single annotated point — a crossover, a payoff. */
  readonly marker?: {
    readonly period: YearMonth
    readonly seriesId: string
    readonly label: string
  }
  readonly height?: number
  readonly controls?: ReactNode
}

interface Datum {
  readonly period: YearMonth
  readonly [seriesId: string]: YearMonth | number | undefined
}

export function MoneyLineChart({
  title,
  description,
  currency,
  periods,
  series,
  marker,
  height = 260,
  controls,
}: MoneyLineChartProps) {
  const { t } = useTranslation('charts')
  const locale = useLocale()

  const data = useMemo<Datum[]>(
    () =>
      periods.map((period) => {
        const datum: Record<string, YearMonth | number | undefined> = { period }
        for (const entry of series) {
          const value = entry.points.get(period)
          datum[entry.id] = value === undefined ? undefined : toMajorUnits(value)
        }
        return datum as Datum
      }),
    [periods, series],
  )

  const plotted = useMemo(() => thin(data, MAX_PLOTTED_POINTS), [data])

  const ticks = useMemo(() => {
    const firstOfYear: YearMonth[] = []
    let lastYear: string | null = null
    for (const period of plotted.map((datum) => datum.period)) {
      const year = period.slice(0, 4)
      if (year !== lastYear) {
        firstOfYear.push(period)
        lastYear = year
      }
    }
    return firstOfYear.length <= 8 ? firstOfYear : thin(firstOfYear, 8)
  }, [plotted])

  const markerValue = useMemo(() => {
    if (marker === undefined) return null
    const entry = series.find((candidate) => candidate.id === marker.seriesId)
    const value = entry?.points.get(marker.period)
    return value === undefined ? null : toMajorUnits(value)
  }, [marker, series])

  return (
    <ChartFrame
      title={title}
      {...(description === undefined ? {} : { description })}
      legend={series.map((entry) => ({
        label: entry.label,
        colour: entry.colour,
        shape: 'line' as const,
      }))}
      {...(controls === undefined ? {} : { controls })}
      table={() => (
        <ChartDataTable
          title={title}
          rows={periods}
          rowKey={(period) => period}
          columns={[
            {
              header: t('axis.period'),
              cell: (period) => <Period period={period} format="short" />,
            },
            ...series.map((entry) => ({
              header: entry.label,
              align: 'right' as const,
              cell: (period: YearMonth) => {
                const value = entry.points.get(period)
                return value === undefined ? (
                  '—'
                ) : (
                  <MoneyText amount={value} currency={currency} withoutSymbol whole />
                )
              },
            })),
          ]}
        />
      )}
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={plotted} margin={{ top: 12, right: 12, bottom: 0, left: 8 }}>
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
            width={56}
            tickFormatter={(value: number) => formatAxisMoney(value, currency, locale)}
          />

          <Tooltip
            cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
            content={({ active, label }) =>
              active === true && typeof label === 'string' ? (
                <ChartTooltip
                  heading={formatPeriod(label as YearMonth, locale, 'long')}
                  // Every series at that x, so the pointer never has to find a line.
                  rows={series.map((entry) => {
                    const value = entry.points.get(label as YearMonth)
                    return {
                      label: entry.label,
                      colour: entry.colour,
                      value:
                        value === undefined ? (
                          '—'
                        ) : (
                          <MoneyText amount={value} currency={currency} whole />
                        ),
                    }
                  })}
                />
              ) : null
            }
          />

          {series.map((entry) => (
            <Line
              key={entry.id}
              type="monotone"
              dataKey={entry.id}
              name={entry.label}
              stroke={entry.colour}
              strokeWidth={entry.muted === true ? 1.5 : MARKS.lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{
                r: MARKS.activeDotRadius,
                strokeWidth: MARKS.ringWidth,
                stroke: CHROME.surface,
              }}
              // Nulls break the line rather than interpolating across a gap, so a series
              // that ends early visibly ends.
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}

          {marker !== undefined && markerValue !== null && (
            <ReferenceDot
              x={marker.period}
              y={markerValue}
              r={MARKS.dotRadius}
              fill={series.find((entry) => entry.id === marker.seriesId)?.colour}
              stroke={CHROME.surface}
              strokeWidth={MARKS.ringWidth}
              label={{
                value: marker.label,
                position: 'top',
                fontSize: 11,
                // Label text wears an ink token, never the series colour.
                fill: 'var(--muted-foreground)',
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/** Builds the period-to-amount map a series needs from a list of rows. */
export function seriesPoints<Row>(
  rows: readonly Row[],
  period: (row: Row) => YearMonth,
  amount: (row: Row) => Money,
): Map<YearMonth, Money> {
  return new Map(rows.map((row) => [period(row), amount(row)]))
}
