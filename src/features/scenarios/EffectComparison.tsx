import type { Loan } from '@/domain/loan'
import type { LoanEvent } from '@/domain/scenario'
import type { ReferenceRateAt } from '@/domain/schedule'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { useScenarioComparison } from '@/app/hooks/useSchedule'
import { useLocale } from '@/app/providers/SettingsProvider'
import { Duration } from '@/components/Duration'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { breakEven } from '@/domain/analytics'
import { fromMajorUnits, subtract } from '@/domain/money'
import { formatMoney } from '@/i18n/format'

/**
 * The comparison the app exists to make.
 *
 * One overpayment, both things it could buy, side by side. No setup and nothing to save —
 * type an amount and the answer is there, because this is the question people actually
 * arrive with.
 *
 * It also states plainly that an overpayment is not a cost, since the surprising part of the
 * numbers below is that the interest saved is smaller than the amount paid in — and that is
 * not a bad deal, it is just money moved earlier.
 */
export function EffectComparison({
  loan,
  rateAt,
}: {
  readonly loan: Loan
  readonly rateAt: ReferenceRateAt | undefined
}) {
  const { t } = useTranslation(['scenarios', 'loan', 'common'] as const)
  const locale = useLocale()
  const from = useCurrentPeriod()
  const [monthlyExtra, setMonthlyExtra] = useState('200')

  const amount = useMemo(() => {
    const parsed = Number(monthlyExtra.replace(',', '.'))
    return Number.isFinite(parsed) && parsed > 0 ? fromMajorUnits(parsed) : null
  }, [monthlyExtra])

  const shortenEvents: readonly LoanEvent[] = useMemo(
    () =>
      amount === null
        ? []
        : [{ kind: 'RECURRING_EXTRA', from, until: null, amount, effect: 'SHORTEN_TERM' }],
    [amount, from],
  )

  const lowerEvents: readonly LoanEvent[] = useMemo(
    () =>
      amount === null
        ? []
        : [{ kind: 'RECURRING_EXTRA', from, until: null, amount, effect: 'LOWER_PAYMENT' }],
    [amount, from],
  )

  const shorten = useScenarioComparison({ loan, rateAt, events: shortenEvents })
  const lower = useScenarioComparison({ loan, rateAt, events: lowerEvents })

  const breakEvenPoint = useMemo(
    () =>
      shorten?.baseline.rows == null || shorten.scenario.rows == null
        ? null
        : breakEven(shorten.baseline.rows, shorten.scenario.rows),
    [shorten],
  )

  if (shorten === null || lower === null) return <Skeleton className="h-64 w-full" />
  if (shorten.baseline.rows === null) return null

  const baselineTotals = shorten.baseline.totals
  const shortenComparison = shorten.comparison
  const lowerComparison = lower.comparison

  const extraSaving =
    shortenComparison !== null && lowerComparison !== null
      ? subtract(shortenComparison.interestSaved, lowerComparison.interestSaved)
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('scenarios:comparison.title')}</CardTitle>
        <CardDescription>{t('scenarios:subtitle')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="monthly-extra">{t('scenarios:field.amount')}</Label>
            <Input
              id="monthly-extra"
              inputMode="decimal"
              className="w-32"
              value={monthlyExtra}
              onChange={(event) => setMonthlyExtra(event.target.value)}
            />
          </div>
          <p className="pb-2 text-sm text-muted-foreground">
            {t('common:units.perMonth', { value: '' })}
            {' · '}
            <Period period={from} format="short" />
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('scenarios:comparison.title')}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 text-left font-medium text-muted-foreground" />
                <th scope="col" className="py-2 text-right font-medium text-muted-foreground">
                  {t('scenarios:baseline')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('scenarios:effect.SHORTEN_TERM')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('scenarios:effect.LOWER_PAYMENT')}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <Th>{t('scenarios:comparison.payoffDate')}</Th>
                <Td>
                  {baselineTotals?.payoffPeriod != null && (
                    <Period period={baselineTotals.payoffPeriod} format="short" />
                  )}
                </Td>
                <Td>
                  {shortenComparison?.scenarioPayoffPeriod != null && (
                    <Period period={shortenComparison.scenarioPayoffPeriod} format="short" />
                  )}
                </Td>
                <Td>
                  {lowerComparison?.scenarioPayoffPeriod != null && (
                    <Period period={lowerComparison.scenarioPayoffPeriod} format="short" />
                  )}
                </Td>
              </tr>

              <tr className="border-b">
                <Th>{t('scenarios:comparison.monthsSaved')}</Th>
                <Td className="text-muted-foreground">—</Td>
                <Td>
                  {shortenComparison !== null && (
                    <Duration months={shortenComparison.monthsSaved} />
                  )}
                </Td>
                <Td>
                  {lowerComparison !== null && <Duration months={lowerComparison.monthsSaved} />}
                </Td>
              </tr>

              <tr className="border-b">
                <Th>{t('scenarios:comparison.totalInterest')}</Th>
                <Td>
                  {baselineTotals !== null && (
                    <Money amount={baselineTotals.interest} currency={loan.currency} whole />
                  )}
                </Td>
                <Td>
                  {shorten.scenario.totals !== null && (
                    <Money
                      amount={shorten.scenario.totals.interest}
                      currency={loan.currency}
                      whole
                    />
                  )}
                </Td>
                <Td>
                  {lower.scenario.totals !== null && (
                    <Money amount={lower.scenario.totals.interest} currency={loan.currency} whole />
                  )}
                </Td>
              </tr>

              <tr className="border-b bg-muted/30">
                <Th>{t('scenarios:comparison.interestSaved')}</Th>
                <Td className="text-muted-foreground">—</Td>
                <Td className="font-semibold">
                  {shortenComparison !== null && (
                    <Money
                      amount={shortenComparison.interestSaved}
                      currency={loan.currency}
                      whole
                      colourBySign
                    />
                  )}
                </Td>
                <Td className="font-semibold">
                  {lowerComparison !== null && (
                    <Money
                      amount={lowerComparison.interestSaved}
                      currency={loan.currency}
                      whole
                      colourBySign
                    />
                  )}
                </Td>
              </tr>

              <tr>
                <Th>{t('scenarios:comparison.extraPaid')}</Th>
                <Td className="text-muted-foreground">—</Td>
                <Td>
                  {shortenComparison !== null && (
                    <Money amount={shortenComparison.extraPaid} currency={loan.currency} whole />
                  )}
                </Td>
                <Td>
                  {lowerComparison !== null && (
                    <Money amount={lowerComparison.extraPaid} currency={loan.currency} whole />
                  )}
                </Td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-2 border-t pt-4 text-sm">
          {extraSaving !== null && (
            <p>
              {t('scenarios:insight.shortenBeatsLower', {
                amount: formatMoney(extraSaving, loan.currency, locale, { whole: true }),
              })}
            </p>
          )}

          {shortenComparison !== null && (
            <p className="text-muted-foreground">
              {t('scenarios:insight.perUnit', {
                unit: formatMoney(fromMajorUnits(1), loan.currency, locale),
                saved: formatMoney(
                  fromMajorUnits(shortenComparison.interestSavedPerUnitOverpaid),
                  loan.currency,
                  locale,
                ),
              })}
            </p>
          )}

          {breakEvenPoint !== null ? (
            <p className="text-muted-foreground">
              {t('scenarios:insight.breakEven', { period: '' })}
              <Period period={breakEvenPoint.period} />
              {'. '}
              {t('scenarios:insight.breakEvenPeak', {
                amount: formatMoney(breakEvenPoint.peakAdditionalOutlay, loan.currency, locale, {
                  whole: true,
                }),
              })}
            </p>
          ) : (
            amount !== null && (
              <p className="text-muted-foreground">{t('scenarios:insight.noBreakEven')}</p>
            )
          )}

          <p className="text-xs text-muted-foreground">
            {t('scenarios:insight.overpaymentNotACost')}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th scope="row" className="py-2 text-left font-normal text-muted-foreground">
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return <td className={`py-2 text-right ${className ?? ''}`}>{children}</td>
}
