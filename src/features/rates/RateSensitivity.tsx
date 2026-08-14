import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { useLocale } from '@/app/providers/SettingsProvider'
import { Money } from '@/components/Money'
import { Rate } from '@/components/Rate'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { totals } from '@/domain/analytics'
import { bpsToRate } from '@/domain/loan'
import { subtract } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { formatBasisPoints } from '@/i18n/format'
import { cn } from '@/lib/cn'
import { SENSITIVITY_SHOCKS_BPS } from '@/rates'

/**
 * What each instalment and the total interest become at different rates.
 *
 * Built by replaying the loan under a rate override rather than by scaling the baseline: an
 * annuity's response to a rate change is not linear, and an approximation here would be
 * wrong in exactly the direction that matters — understating the pain of a rise.
 *
 * The override runs from the current period onward, so the reconstructed past stays factual
 * and only the projection moves.
 */
export function RateSensitivity({
  loan,
  baselineRows,
}: {
  readonly loan: Loan
  readonly baselineRows: readonly PaymentRow[]
}) {
  const { t } = useTranslation(['rates', 'common'] as const)
  const locale = useLocale()
  const from = useCurrentPeriod()

  const currentRate =
    baselineRows.find((row) => row.period >= from)?.annualRate ??
    baselineRows.at(-1)?.annualRate ??
    0

  const variants = useMemo(() => {
    const baselineTotals = totals(baselineRows)

    return SENSITIVITY_SHOCKS_BPS.map((deltaBps) => {
      const shockedRate = currentRate + bpsToRate(deltaBps)

      try {
        const rows = replay({
          loan,
          // A fixed override, so no reference lookup is needed for the shocked periods.
          referenceRateAt: () => null,
          events: [{ kind: 'RATE_OVERRIDE', from, until: null, annualRate: shockedRate }],
          maxPeriods: loan.termMonths + 240,
        })

        const shockedTotals = totals(rows)
        const instalment = rows.find((row) => row.period >= from)?.totalPaid ?? null
        const baselineInstalment = baselineRows.find((row) => row.period >= from)?.totalPaid ?? null

        return {
          deltaBps,
          rate: shockedRate,
          instalment,
          extraPerMonth:
            instalment === null || baselineInstalment === null
              ? null
              : subtract(instalment, baselineInstalment),
          totalInterest: shockedTotals.interest,
          interestDelta: subtract(shockedTotals.interest, baselineTotals.interest),
        }
      } catch {
        // A large enough shock can make the loan fail to amortise within the period cap.
        // That is information, not an error — the row is shown without figures.
        return {
          deltaBps,
          rate: shockedRate,
          instalment: null,
          extraPerMonth: null,
          totalInterest: null,
          interestDelta: null,
        }
      }
    })
  }, [loan, baselineRows, currentRate, from])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('sensitivity.title')}</CardTitle>
        <CardDescription>{t('sensitivity.explanation')}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('chart.effectiveRate')}</TableHead>
              <TableHead className="text-right">{t('sensitivity.monthlyPayment')}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                {t('sensitivity.extraPerMonth')}
              </TableHead>
              <TableHead className="text-right">{t('sensitivity.totalInterest')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((variant) => (
              <TableRow
                key={variant.deltaBps}
                className={cn(variant.deltaBps === 0 && 'bg-muted/40 font-medium')}
              >
                <TableCell>
                  <Rate value={variant.rate} decimals={2} />
                  <span className="ml-2 text-xs text-muted-foreground">
                    {variant.deltaBps === 0
                      ? t('sensitivity.base')
                      : t('common:units.basisPoints', {
                          value: formatBasisPoints(variant.deltaBps, locale),
                        })}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {variant.instalment === null ? (
                    '—'
                  ) : (
                    <Money amount={variant.instalment} currency={loan.currency} />
                  )}
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  {variant.extraPerMonth === null ? (
                    '—'
                  ) : (
                    <Money
                      amount={variant.extraPerMonth}
                      currency={loan.currency}
                      signed
                      colourBySign
                    />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {variant.totalInterest === null ? (
                    '—'
                  ) : (
                    <Money amount={variant.totalInterest} currency={loan.currency} whole />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
