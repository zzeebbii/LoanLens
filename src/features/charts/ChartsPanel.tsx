import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'
import type { RateSeries } from '@/rates'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CapitalInterestArea } from '@/components/charts/CapitalInterestArea'
import { InterestHeatmap } from '@/components/charts/InterestHeatmap'
import { KpiTiles } from '@/components/charts/KpiTiles'
import { LifetimeSplit } from '@/components/charts/LifetimeSplit'
import { MoneyLineChart, seriesPoints } from '@/components/charts/MoneyLineChart'
import { SERIES } from '@/components/charts/palette'
import { PaymentAnatomy } from '@/components/charts/PaymentAnatomy'
import { RateHistoryLine } from '@/components/charts/RateHistoryLine'
import { SensitivityBars } from '@/components/charts/SensitivityBars'
import { Skeleton } from '@/components/ui/skeleton'
import { totals } from '@/domain/analytics'

/**
 * Every chart for one loan, in the order the questions arrive.
 *
 * Headline figures first, then where the money goes, then what is left, then the year-by-year
 * cost, then the rate that drove it all, then the two views that reward closer reading.
 *
 * Ordering is the whole design here: someone who looks at only the first screen should still
 * come away with the four numbers that matter.
 */
export function ChartsPanel({
  loan,
  rows,
  series,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[] | null
  readonly series: RateSeries | null
}) {
  const { t } = useTranslation('charts')

  const summary = useMemo(() => (rows === null ? null : totals(rows)), [rows])

  const balancePoints = useMemo(
    () =>
      rows === null
        ? null
        : seriesPoints(
            rows,
            (row) => row.period,
            (row) => row.closingBalance,
          ),
    [rows],
  )

  if (rows === null || summary === null || balancePoints === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>
  }

  return (
    <div className="space-y-6">
      <KpiTiles loan={loan} rows={rows} totals={summary} />

      <CapitalInterestArea loan={loan} rows={rows} />

      <MoneyLineChart
        title={t('balance.title')}
        description={t('balance.description')}
        currency={loan.currency}
        periods={rows.map((row) => row.period)}
        series={[
          {
            id: 'balance',
            label: t('balance.balance'),
            colour: SERIES.capital,
            points: balancePoints,
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <LifetimeSplit loan={loan} totals={summary} />
        <PaymentAnatomy loan={loan} rows={rows} />
      </div>

      {/* Only meaningful for a floating-rate loan; a fixed rate is a flat line. */}
      {loan.rateBasis.kind === 'FLOATING' && <RateHistoryLine loan={loan} rows={rows} />}

      <SensitivityBars loan={loan} baselineRows={rows} />

      <InterestHeatmap loan={loan} rows={rows} />

      {series !== null && series.points.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      )}
    </div>
  )
}
