import type { YearMonth } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { useLocale } from '@/app/providers/SettingsProvider'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { SERIES } from '@/components/charts/palette'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isPositive, toMajorUnits } from '@/domain/money'
import { formatMoney, formatPeriod } from '@/i18n/format'

/**
 * One instalment, taken apart.
 *
 * A horizontal stacked bar rather than a waterfall. A waterfall is for a running total
 * arriving at a figure through gains and losses; this is a single amount divided into
 * parts, which is part-to-whole — and the segments are directly comparable at a glance
 * because they share a baseline.
 *
 * Answering "where does *this* month's payment actually go" is the moment the whole
 * schedule becomes concrete, so the month is selectable rather than fixed.
 */
export function PaymentAnatomy({
  loan,
  rows,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
}) {
  const { t } = useTranslation('charts')
  const locale = useLocale()
  const currentPeriod = useCurrentPeriod()

  const initial = useMemo(
    () =>
      rows.find((row) => row.period === currentPeriod)?.period ??
      rows.find((row) => row.period > currentPeriod)?.period ??
      rows[0]?.period,
    [rows, currentPeriod],
  )

  const [selected, setSelected] = useState(initial)
  const row = rows.find((candidate) => candidate.period === selected) ?? rows[0]

  if (row === undefined || initial === undefined) return null

  const parts = [
    {
      key: 'capital',
      label: t('capitalVsInterest.capital'),
      amount: row.capital,
      colour: SERIES.capital,
    },
    {
      key: 'interest',
      label: t('capitalVsInterest.interest'),
      amount: row.interest,
      colour: SERIES.interest,
    },
    {
      key: 'extra',
      label: t('paymentAnatomy.extra'),
      amount: row.extraPayment,
      colour: SERIES.alternative,
    },
    { key: 'fees', label: t('capitalVsInterest.fees'), amount: row.fees, colour: SERIES.fees },
  ].filter((part) => isPositive(part.amount))

  const total = toMajorUnits(row.totalPaid)

  return (
    <ChartFrame
      title={t('paymentAnatomy.title')}
      description={t('paymentAnatomy.description', {
        amount: formatMoney(row.totalPaid, loan.currency, locale),
        period: formatPeriod(row.period, locale, 'long'),
      })}
      legend={parts.map((part) => ({ label: part.label, colour: part.colour }))}
      controls={
        // The cast is safe: Radix hands back a plain string, and every option's value came
        // from a `YearMonth` in `rows`. Bound to the row actually shown rather than to the
        // raw selection, so the control always agrees with the chart.
        <Select value={row.period} onValueChange={(value) => setSelected(value as YearMonth)}>
          <SelectTrigger size="sm" className="w-40" aria-label={t('axis.period')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/*
             * Rate resets and overpayments are the months worth looking at, plus the first
             * and last. A 300-item dropdown is not a control anyone uses.
             */}
            {rows
              .filter(
                (candidate) =>
                  candidate.index === 1 ||
                  candidate.index === rows.length ||
                  candidate.period === initial ||
                  candidate.flags.includes('RATE_RESET') ||
                  isPositive(candidate.extraPayment),
              )
              .map((candidate) => (
                <SelectItem key={candidate.period} value={candidate.period}>
                  {formatPeriod(candidate.period, locale, 'short')}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-4">
        <div
          className="flex h-10 w-full gap-0.5 overflow-hidden rounded-md"
          role="img"
          aria-label={parts
            .map((part) => `${part.label} ${formatMoney(part.amount, loan.currency, locale)}`)
            .join(', ')}
        >
          {parts.map((part) => (
            <div
              key={part.key}
              aria-hidden
              className="h-full first:rounded-l-md last:rounded-r-md"
              style={{
                backgroundColor: part.colour,
                width: `${(toMajorUnits(part.amount) / total) * 100}%`,
              }}
            />
          ))}
        </div>

        {/*
         * The values sit in a list beneath rather than inside the segments. A label inside a
         * narrow segment either overflows or gets clipped, and clipping a money figure is
         * worse than not showing it.
         */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {parts.map((part) => (
            <div key={part.key}>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: part.colour }}
                />
                {part.label}
              </dt>
              <dd className="mt-0.5 font-medium">
                <Money amount={part.amount} currency={loan.currency} />
              </dd>
            </div>
          ))}
        </dl>

        <p className="border-t pt-3 text-sm">
          <span className="text-muted-foreground">{t('paymentAnatomy.total')} </span>
          <span className="font-medium">
            <Money amount={row.totalPaid} currency={loan.currency} />
          </span>
          <span className="ml-2 text-muted-foreground">
            <Period period={row.period} format="long" />
          </span>
        </p>
      </div>
    </ChartFrame>
  )
}
