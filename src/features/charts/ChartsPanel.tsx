import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'
import type { RateSeries } from '@/rates'

import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for the charts phase.
 *
 * The data plumbing is complete — rows and the rate series arrive here ready to plot. The
 * charts themselves are built next, against the `dataviz` guidance.
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

  if (rows === null) return <Skeleton className="h-96 w-full" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('capitalVsInterest.title')}</CardTitle>
        <CardDescription>{t('capitalVsInterest.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {rows.length} · {loan.currency} · {series?.points.length ?? 0}
        </p>
      </CardContent>
    </Card>
  )
}
