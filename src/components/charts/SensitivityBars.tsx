import type { Loan } from '@/domain/loan'
import type { Money } from '@/domain/money'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { useLocale } from '@/app/providers/SettingsProvider'
import { ChartDataTable } from '@/components/charts/ChartDataTable'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { CHROME, MARKS, ORDINAL_RAMP } from '@/components/charts/palette'
import { Money as MoneyText } from '@/components/Money'
import { Rate } from '@/components/Rate'
import { totals } from '@/domain/analytics'
import { bpsToRate } from '@/domain/loan'
import { subtract, toMajorUnits } from '@/domain/money'
import { replay } from '@/domain/schedule'
import { formatAxisMoney, formatBasisPoints } from '@/i18n/format'
import { SENSITIVITY_SHOCKS_BPS } from '@/rates'

/**
 * Total interest at different rates.
 *
 * Coloured with the **ordinal** ramp, not the categorical palette. The categories here —
 * −100bp, base, +100bp — have a natural order, so hue should carry it: darker means a
 * higher rate and a bigger bill. A categorical palette would spend three identities on
 * information the ordering already gives, and would make the base row no easier to find.
 *
 * Each variant is a full replay under a rate override rather than a scaled baseline. An
 * annuity's response to a rate change is not linear, and an approximation would understate
 * the pain of a rise — the direction that matters.
 */
interface Variant {
  readonly deltaBps: number
  readonly rate: number
  readonly totalInterest: Money | null
  readonly instalment: Money | null
  readonly extraPerMonth: Money | null
  readonly interestDelta: Money | null
  readonly colour: string
}

export function SensitivityBars({
  loan,
  baselineRows,
}: {
  readonly loan: Loan
  readonly baselineRows: readonly PaymentRow[]
}) {
  const { t } = useTranslation(['charts', 'rates', 'common'] as const)
  const locale = useLocale()
  const from = useCurrentPeriod()

  const variants = useMemo<Variant[]>(() => {
    const baselineTotals = totals(baselineRows)
    const currentRate =
      baselineRows.find((row) => row.period >= from)?.annualRate ??
      baselineRows.at(-1)?.annualRate ??
      0
    const baselineInstalment = baselineRows.find((row) => row.period >= from)?.totalPaid ?? null

    return SENSITIVITY_SHOCKS_BPS.map((deltaBps, index) => {
      const rate = currentRate + bpsToRate(deltaBps)
      const colour = ORDINAL_RAMP[index] ?? ORDINAL_RAMP.at(-1) ?? ORDINAL_RAMP[0]

      try {
        const rows = replay({
          loan,
          referenceRateAt: () => null,
          events: [{ kind: 'RATE_OVERRIDE', from, until: null, annualRate: rate }],
          maxPeriods: loan.termMonths + 240,
        })
        const shocked = totals(rows)
        const instalment = rows.find((row) => row.period >= from)?.totalPaid ?? null

        return {
          deltaBps,
          rate,
          totalInterest: shocked.interest,
          instalment,
          extraPerMonth:
            instalment === null || baselineInstalment === null
              ? null
              : subtract(instalment, baselineInstalment),
          interestDelta: subtract(shocked.interest, baselineTotals.interest),
          colour,
        }
      } catch {
        // A large enough shock can stop the loan amortising within the period cap. That is
        // a finding, not a failure — the bar is simply absent and the table says so.
        return {
          deltaBps,
          rate,
          totalInterest: null,
          instalment: null,
          extraPerMonth: null,
          interestDelta: null,
          colour,
        }
      }
    })
  }, [loan, baselineRows, from])

  const data = useMemo(
    () =>
      variants.map((variant) => ({
        label:
          variant.deltaBps === 0
            ? t('rates:sensitivity.base')
            : formatBasisPoints(variant.deltaBps, locale),
        value: variant.totalInterest === null ? 0 : toMajorUnits(variant.totalInterest),
        variant,
      })),
    [variants, t, locale],
  )

  return (
    <ChartFrame
      title={t('charts:sensitivity.title')}
      description={t('charts:sensitivity.description')}
      table={() => (
        <ChartDataTable
          title={t('charts:sensitivity.title')}
          rows={variants}
          rowKey={(variant) => String(variant.deltaBps)}
          columns={[
            {
              header: t('charts:axis.rate'),
              cell: (variant) => <Rate value={variant.rate} decimals={2} />,
            },
            {
              header: t('rates:sensitivity.monthlyPayment'),
              align: 'right',
              cell: (variant) =>
                variant.instalment === null ? (
                  '—'
                ) : (
                  <MoneyText amount={variant.instalment} currency={loan.currency} />
                ),
            },
            {
              header: t('rates:sensitivity.extraPerMonth'),
              align: 'right',
              cell: (variant) =>
                variant.extraPerMonth === null ? (
                  '—'
                ) : (
                  <MoneyText
                    amount={variant.extraPerMonth}
                    currency={loan.currency}

                    signed
                  />
                ),
            },
            {
              header: t('rates:sensitivity.totalInterest'),
              align: 'right',
              cell: (variant) =>
                variant.totalInterest === null ? (
                  '—'
                ) : (
                  <MoneyText amount={variant.totalInterest} currency={loan.currency} />
                ),
            },
          ]}
        />
      )}
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHROME.grid} strokeWidth={1} vertical={false} />

          <XAxis
            dataKey="label"
            stroke={CHROME.axis}
            tick={{ fontSize: 11, fill: CHROME.axis }}
            tickLine={false}
            axisLine={{ stroke: CHROME.grid }}
          />
          <YAxis
            stroke={CHROME.axis}
            tick={{ fontSize: 11, fill: CHROME.axis }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => formatAxisMoney(value, loan.currency, locale)}
          />

          <Tooltip
            cursor={{ fill: 'var(--accent)', fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              const variant = (payload?.[0]?.payload as { variant?: Variant } | undefined)?.variant
              return active === true && variant !== undefined ? (
                <ChartTooltip
                  heading={<Rate value={variant.rate} decimals={2} />}
                  rows={[
                    {
                      label: t('rates:sensitivity.totalInterest'),
                      value:
                        variant.totalInterest === null ? (
                          '—'
                        ) : (
                          <MoneyText
                            amount={variant.totalInterest}
                            currency={loan.currency}
                            whole
                          />
                        ),
                    },
                    {
                      label: t('rates:sensitivity.monthlyPayment'),
                      value:
                        variant.instalment === null ? (
                          '—'
                        ) : (
                          <MoneyText amount={variant.instalment} currency={loan.currency} />
                        ),
                    },
                    {
                      label: t('rates:sensitivity.extraPerMonth'),
                      value:
                        variant.extraPerMonth === null ? (
                          '—'
                        ) : (
                          <MoneyText
                            amount={variant.extraPerMonth}
                            currency={loan.currency}
                            signed
                          />
                        ),
                    },
                  ]}
                  footer={
                    variant.deltaBps === 0
                      ? t('rates:sensitivity.base')
                      : t('common:units.basisPoints', {
                          value: formatBasisPoints(variant.deltaBps, locale),
                        })
                  }
                />
              ) : null
            }}
          />

          <Bar
            dataKey="value"
            maxBarSize={MARKS.maxBarWidth * 2}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {/* One cell per bar so each takes its own ramp step. */}
            {data.map((datum) => (
              <Cell
                key={datum.variant.deltaBps}
                fill={datum.variant.colour}
                stroke={CHROME.surface}
                strokeWidth={MARKS.gap}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
