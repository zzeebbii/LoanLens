import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'
import type { RateSeries } from '@/rates'

import { GlobeIcon, ShieldCheckIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useRateProviders } from '@/app/providers/RateProviderContext'
import { useLocale } from '@/app/providers/SettingsProvider'
import { Period } from '@/components/Period'
import { Rate } from '@/components/Rate'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ForecastPicker } from '@/features/rates/ForecastPicker'
import { RateSensitivity } from '@/features/rates/RateSensitivity'
import { translateDynamic } from '@/i18n/dynamicKey'

/**
 * Where the rate came from, and what happens to it next.
 *
 * The privacy note is here rather than buried in settings because this is the page where a
 * user is thinking about the network request, and a claim about data leaving the device is
 * worth making next to the thing that makes the request.
 */
export function RatesPanel({
  loan,
  series,
  rows,
}: {
  readonly loan: Loan
  readonly series: RateSeries | null
  readonly rows: readonly PaymentRow[] | null
}) {
  const { t } = useTranslation(['rates', 'loan'] as const)
  const locale = useLocale()
  const registry = useRateProviders()

  if (loan.rateBasis.kind === 'FIXED') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('loan:rate.fixed')}</CardTitle>
          <CardDescription>
            <Rate value={loan.rateBasis.annualRate} />
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const basis = loan.rateBasis
  const provider = registry.find(basis.reference.providerId)
  const resets = rows?.filter((row) => row.flags.includes('RATE_RESET')) ?? []

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('rates:title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.provider')}</dt>
              <dd className="font-medium">
                {provider === undefined
                  ? basis.reference.providerId
                  : translateDynamic(t, provider.labelKey)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.tenor')}</dt>
              <dd className="font-medium">{t(`rates:tenor.${basis.reference.tenor}`)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.margin')}</dt>
              <dd className="font-medium">
                <Rate value={basis.marginBps / 10_000} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.referenceFloor')}</dt>
              <dd className="font-medium">
                {basis.referenceFloor === null ? (
                  t('loan:rate.noFloor')
                ) : (
                  <Rate value={basis.referenceFloor} decimals={2} />
                )}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {provider?.requiresNetwork === true ? (
              <Badge variant="secondary">
                <GlobeIcon aria-hidden />
                {t('rates:provider.network')}
              </Badge>
            ) : (
              <Badge variant="success">
                <ShieldCheckIcon aria-hidden />
                {t('rates:provider.offline')}
              </Badge>
            )}
            {series?.retrievedAt != null && (
              <span className="text-xs text-muted-foreground">
                {t('rates:provider.retrievedAt', {
                  date: new Date(series.retrievedAt).toLocaleDateString(locale),
                })}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">{t('rates:provider.privacyNote')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('rates:forecast.title', { period: '' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <ForecastPicker />
        </CardContent>
      </Card>

      {rows !== null && <RateSensitivity loan={loan} baselineRows={rows} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('rates:chart.resetMarker')}</CardTitle>
          <CardDescription>{t('loan:rate.resetMonths')}</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {rows === null ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('rates:chart.resetMarker')}</TableHead>
                  <TableHead className="text-right">{t('rates:chart.referenceRate')}</TableHead>
                  <TableHead className="text-right">{t('rates:chart.effectiveRate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resets.map((row) => (
                  <TableRow key={row.index}>
                    <TableCell>
                      <Period period={row.period} format="short" />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.referenceRate === null ? '—' : <Rate value={row.referenceRate} />}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Rate value={row.annualRate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
