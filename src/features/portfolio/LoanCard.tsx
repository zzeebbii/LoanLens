import type { Loan } from '@/domain/loan'

import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { horizonFor, useLoanRates } from '@/app/hooks/useRateSeries'
import { useSchedule } from '@/app/hooks/useSchedule'
import { useLocale, useSettings } from '@/app/providers/SettingsProvider'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { Rate } from '@/components/Rate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { progressToDate } from '@/domain/analytics'
import { formatPercentChange } from '@/i18n/format'

/**
 * One loan, summarised.
 *
 * Answers the three questions someone opening the app actually has: what do I still owe,
 * what am I paying, and when am I done.
 */
export function LoanCard({ loan }: { readonly loan: Loan }) {
  const { t } = useTranslation(['common', 'loan', 'charts'] as const)
  const locale = useLocale()
  const { settings } = useSettings()
  const asOf = useCurrentPeriod()

  const rates = useLoanRates({
    loan,
    forecast: settings.defaultForecast,
    horizon: horizonFor(loan),
  })
  const schedule = useSchedule({ loan, rateAt: rates.data?.rateAt })

  const progress = useMemo(
    () => (schedule?.rows == null ? null : progressToDate(schedule.rows, asOf)),
    [schedule, asOf],
  )

  const current = schedule?.rows?.find((row) => row.period === asOf) ?? schedule?.rows?.at(-1)
  const repaidPercent = formatPercentChange(progress?.capitalRepaidRatio ?? 0, locale, 0).replace(
    '+',
    '',
  )

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{loan.name}</CardTitle>
          <Badge variant="secondary">
            {loan.rateBasis.kind === 'FLOATING' ? t('loan:rate.floating') : t('loan:rate.fixed')}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {schedule === null || progress === null ? (
          <Skeleton className="h-28 w-full" />
        ) : schedule.error === null ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t('loan:summary.remainingBalance')}</dt>
                <dd className="text-lg font-semibold">
                  <Money amount={progress.remainingBalance} currency={loan.currency} whole />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('loan:summary.monthlyPayment')}</dt>
                <dd className="text-lg font-semibold">
                  {current !== undefined && (
                    <Money amount={current.totalPaid} currency={loan.currency} />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('loan:summary.currentRate')}</dt>
                <dd>{current !== undefined && <Rate value={current.annualRate} />}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('loan:summary.payoffDate')}</dt>
                <dd>
                  {schedule.totals.payoffPeriod !== null && (
                    <Period period={schedule.totals.payoffPeriod} format="short" />
                  )}
                </dd>
              </div>
            </dl>

            <div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.capitalRepaidRatio * 100)}
                aria-label={t('loan:summary.progress', { percent: repaidPercent })}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.min(100, progress.capitalRepaidRatio * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('loan:summary.progress', { percent: repaidPercent })}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('charts:empty')}</p>
        )}
      </CardContent>

      <CardFooter>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link to="/loans/$loanId" params={{ loanId: loan.id }}>
            {t('loan:title')}
            <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
