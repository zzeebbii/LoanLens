import type { Loan } from '@/domain/loan'
import type { LoanEvent } from '@/domain/scenario'
import type { ReferenceRateAt } from '@/domain/schedule'

import { ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { Rate } from '@/components/Rate'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { capEffect } from '@/domain/analytics'
import { bpsToRate } from '@/domain/loan'
import { isNegative } from '@/domain/money'

/**
 * Whether the cap was worth buying.
 *
 * The two halves are shown side by side and never merged, because the netted figure alone
 * cannot be decided with: a cap that saved €9,000 and cost €7,000 nets to the same €2,000 as
 * one that saved €2,000 and cost nothing, and they are entirely different bargains.
 *
 * The figures depend on the forecast assumption for every month past the published rate data,
 * so the card says so rather than presenting a projection as a finding.
 */
/**
 * Hoisted so the default is referentially stable.
 *
 * A `[]` literal in the parameter list is a new array every render, which would defeat the
 * `useMemo` below — and that memo guards three full replays of the loan.
 */
const NO_EVENTS: readonly LoanEvent[] = []

export function CapEffectCard({
  loan,
  rateAt,
  events = NO_EVENTS,
}: {
  readonly loan: Loan
  readonly rateAt: ReferenceRateAt | undefined
  readonly events?: readonly LoanEvent[]
}) {
  const { t } = useTranslation(['rates', 'loan'] as const)

  const effect = useMemo(
    () => (rateAt === undefined ? null : capEffect({ loan, rateAt, events })),
    [loan, rateAt, events],
  )

  const cap = loan.rateBasis.kind === 'FLOATING' ? loan.rateBasis.cap : null

  if (effect === null || !effect.hasCap) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('rates:cap.title')}</CardTitle>
        <CardDescription>{t('rates:cap.description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {cap !== null && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.capCeiling')}</dt>
              <dd className="font-medium">
                <Rate value={cap.ceiling} decimals={2} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.capPremium')}</dt>
              <dd className="font-medium">
                <Rate value={bpsToRate(cap.premiumBps)} decimals={2} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.capFrom')}</dt>
              <dd className="font-medium">
                <Period period={cap.from} format="short" />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('loan:rate.capUntil')}</dt>
              <dd className="font-medium">
                {cap.until === null ? (
                  t('loan:rate.capOpenEnded')
                ) : (
                  <Period period={cap.until} format="short" />
                )}
              </dd>
            </div>
          </dl>
        )}

        <dl className="grid gap-4 border-t pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t('rates:cap.interestAvoided')}</dt>
            <dd className="mt-0.5 text-xl font-semibold">
              <Money amount={effect.interestAvoided} currency={loan.currency} whole />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('rates:cap.premiumCost')}</dt>
            <dd className="mt-0.5 text-xl font-semibold">
              <Money amount={effect.premiumCost} currency={loan.currency} whole />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('rates:cap.net')}</dt>
            <dd className="mt-0.5 text-xl font-semibold">
              <Money amount={effect.net} currency={loan.currency} whole signed colourBySign />
            </dd>
          </div>
        </dl>

        <Alert variant={effect.worthwhile ? 'info' : 'warning'}>
          {effect.worthwhile ? <ShieldCheckIcon aria-hidden /> : <ShieldOffIcon aria-hidden />}
          <AlertTitle>
            {effect.worthwhile ? t('rates:cap.worthwhile') : t('rates:cap.notWorthwhile')}
          </AlertTitle>
          <AlertDescription>
            <p>
              {isNegative(effect.net)
                ? t('rates:cap.notWorthwhileBody')
                : t('rates:cap.worthwhileBody')}
            </p>
            {/* The judgement is only as good as the rate path behind it. */}
            <p>{t('rates:cap.forecastCaveat')}</p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}
