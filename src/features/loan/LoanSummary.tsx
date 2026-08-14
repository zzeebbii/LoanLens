import type { Schedule } from '@/app/hooks/useSchedule'
import type { Loan } from '@/domain/loan'

import { DatabaseIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { useLocale } from '@/app/providers/SettingsProvider'
import { Duration } from '@/components/Duration'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { Rate } from '@/components/Rate'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { progressToDate } from '@/domain/analytics'
import { formatPercentChange } from '@/i18n/format'

/**
 * The headline figures for one loan.
 *
 * Ordered by what a borrower asks first: what do I owe, what am I paying, what has it cost
 * me so far, and when is it over.
 */
export function LoanSummary({
  loan,
  schedule,
  usedFallback,
}: {
  readonly loan: Loan
  readonly schedule: Schedule | null
  readonly usedFallback: boolean
}) {
  const { t } = useTranslation(['loan', 'rates'] as const)
  const locale = useLocale()
  const asOf = useCurrentPeriod()

  const progress = useMemo(
    () => (schedule?.rows == null ? null : progressToDate(schedule.rows, asOf)),
    [schedule, asOf],
  )

  if (schedule === null || progress === null || schedule.rows === null) {
    return <Skeleton className="h-32 w-full" />
  }

  const current =
    schedule.rows.find((row) => row.period === asOf) ??
    schedule.rows.find((row) => row.period > asOf) ??
    schedule.rows.at(-1)

  return (
    <div className="space-y-3">
      {usedFallback && (
        <Alert variant="warning">
          <DatabaseIcon aria-hidden />
          <AlertDescription>{t('rates:status.usingSnapshotBecause')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4 lg:grid-cols-6">
            <Figure label={t('loan:summary.remainingBalance')}>
              <Money amount={progress.remainingBalance} currency={loan.currency} whole />
            </Figure>

            <Figure label={t('loan:summary.monthlyPayment')}>
              {current !== undefined && (
                <Money amount={current.totalPaid} currency={loan.currency} />
              )}
            </Figure>

            <Figure label={t('loan:summary.currentRate')}>
              {current !== undefined && <Rate value={current.annualRate} />}
            </Figure>

            <Figure label={t('loan:summary.interestToDate')}>
              <Money amount={progress.interestToDate} currency={loan.currency} whole />
            </Figure>

            <Figure label={t('loan:summary.payoffDate')}>
              {schedule.totals.payoffPeriod !== null && (
                <Period period={schedule.totals.payoffPeriod} format="short" />
              )}
            </Figure>

            <Figure label={t('loan:summary.totalInterest')}>
              <Money amount={schedule.totals.interest} currency={loan.currency} whole />
            </Figure>
          </dl>

          <p className="mt-5 border-t pt-4 text-sm text-muted-foreground">
            {t('loan:summary.interestShare', {
              percent: formatPercentChange(schedule.totals.interestRatio, locale, 1).replace(
                '+',
                '',
              ),
            })}
            {' · '}
            <Duration months={progress.periodsRemaining} /> {t('loan:summary.remainingBalance')}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Figure({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{children}</dd>
    </div>
  )
}
