import type { ScheduleTotals } from '@/domain/analytics'
import type { YearMonth } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { useLocale } from '@/app/providers/SettingsProvider'
import { thin } from '@/components/charts/data'
import { SERIES } from '@/components/charts/palette'
import { Duration } from '@/components/Duration'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { Card, CardContent } from '@/components/ui/card'
import { progressToDate } from '@/domain/analytics'
import { toMajorUnits } from '@/domain/money'
import { formatPercentChange } from '@/i18n/format'

/**
 * The headline figures, as stat tiles.
 *
 * Tiles rather than a chart because each of these is a single number — the anti-pattern
 * being a one-bar bar chart or a grouped bar of four unrelated quantities. A sparkline
 * rides the two that have a shape worth seeing.
 */
export function KpiTiles({
  loan,
  rows,
  totals,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
  readonly totals: ScheduleTotals
}) {
  const { t } = useTranslation(['loan', 'charts'] as const)
  const locale = useLocale()
  const asOf = useCurrentPeriod()

  const progress = useMemo(() => progressToDate(rows, asOf), [rows, asOf])

  const balanceTrend = useMemo(
    () =>
      thin(
        rows.map((row) => toMajorUnits(row.closingBalance)),
        24,
      ),
    [rows],
  )
  const interestTrend = useMemo(
    () =>
      thin(
        rows.map((row) => toMajorUnits(row.interest)),
        24,
      ),
    [rows],
  )

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label={t('loan:summary.remainingBalance')}
        value={<Money amount={progress.remainingBalance} currency={loan.currency} whole />}
        note={t('loan:summary.progress', {
          percent: formatPercentChange(progress.capitalRepaidRatio, locale, 0).replace('+', ''),
        })}
        trend={balanceTrend}
        colour={SERIES.capital}
      />

      <Tile
        label={t('loan:summary.interestToDate')}
        value={<Money amount={progress.interestToDate} currency={loan.currency} whole />}
        note={t('charts:kpi.ofTotal')}
        trend={interestTrend}
        colour={SERIES.interest}
      />

      <Tile
        label={t('loan:summary.payoffDate')}
        value={
          totals.payoffPeriod === null ? (
            '—'
          ) : (
            <Period period={totals.payoffPeriod as YearMonth} format="short" />
          )
        }
        note={<Duration months={progress.periodsRemaining} />}
      />

      <Tile
        label={t('loan:summary.totalInterest')}
        value={<Money amount={totals.interest} currency={loan.currency} whole />}
        note={t('loan:summary.interestShare', {
          percent: formatPercentChange(totals.interestRatio, locale, 1).replace('+', ''),
        })}
      />
    </div>
  )
}

function Tile({
  label,
  value,
  note,
  trend,
  colour,
}: {
  readonly label: string
  readonly value: React.ReactNode
  readonly note: React.ReactNode
  readonly trend?: readonly number[]
  readonly colour?: string
}) {
  return (
    <Card>
      <CardContent className="space-y-1">
        {/* Sentence case, no trailing colon. */}
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
        {trend !== undefined && colour !== undefined && (
          <Sparkline values={trend} colour={colour} />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * A sparkline, drawn as an inline SVG.
 *
 * Hand-drawn rather than pulled from the chart library: a 24-point path needs no axes, no
 * tooltip and no responsive container, and rendering a full chart component per tile costs
 * far more than the path is worth. Marked `aria-hidden` because the number above it is the
 * accessible content — the line only shows a shape.
 */
function Sparkline({
  values,
  colour,
}: {
  readonly values: readonly number[]
  readonly colour: string
}) {
  if (values.length < 2) return null

  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  const span = highest - lowest || 1

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 100 - ((value - lowest) / span) * 100
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="mt-1 h-6 w-full"
      aria-hidden
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke={colour}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
