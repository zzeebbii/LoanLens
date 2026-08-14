import type { ScheduleTotals } from '@/domain/analytics'
import type { Loan } from '@/domain/loan'

import { useTranslation } from 'react-i18next'

import { useLocale } from '@/app/providers/SettingsProvider'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { SERIES } from '@/components/charts/palette'
import { Money } from '@/components/Money'
import { add, toMajorUnits } from '@/domain/money'
import { formatPercentChange } from '@/i18n/format'

/**
 * What the loan costs in total, as one bar.
 *
 * Explicitly **not** a donut. A two-slice pie is a documented anti-pattern: the reader
 * cannot judge the angles, and the same fact fits in one bar plus a number. The headline
 * ratio does the real work — "interest is 49% of what you borrowed" is the sentence
 * someone repeats afterwards — and the bar gives it a shape.
 *
 * Both segments are directly labelled, which is also the relief the palette's contrast
 * warning requires: identity never rests on the hue alone.
 */
export function LifetimeSplit({
  loan,
  totals,
}: {
  readonly loan: Loan
  readonly totals: ScheduleTotals
}) {
  const { t } = useTranslation('charts')
  const locale = useLocale()

  const principal = toMajorUnits(totals.principal)
  const interest = toMajorUnits(totals.interest)
  const fees = toMajorUnits(totals.fees)
  const total = principal + interest + fees

  if (total <= 0) return null

  const share = (part: number) => `${(part / total) * 100}%`
  const ratioLabel = formatPercentChange(totals.interestRatio, locale, 1).replace('+', '')

  return (
    <ChartFrame
      title={t('lifetimeSplit.title')}
      description={t('lifetimeSplit.description')}
      legend={[
        { label: t('lifetimeSplit.principal'), colour: SERIES.capital },
        { label: t('lifetimeSplit.interest'), colour: SERIES.interest },
        ...(fees > 0 ? [{ label: t('capitalVsInterest.fees'), colour: SERIES.fees }] : []),
      ]}
    >
      <div className="space-y-5">
        {/* The hero figure: the one number a reader takes away. */}
        <div>
          <p className="tabular text-4xl font-semibold tracking-tight">{ratioLabel}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('lifetimeSplit.ratioNote', { percent: ratioLabel })}
          </p>
        </div>

        {/*
         * One bar, segments separated by a 2px surface gap rather than a border. Marked up
         * as an image with a label so a screen reader gets the summary rather than reading
         * three empty divs.
         */}
        <div
          className="flex h-8 w-full gap-0.5 overflow-hidden rounded-md"
          role="img"
          aria-label={`${t('lifetimeSplit.principal')} ${principal}, ${t('lifetimeSplit.interest')} ${interest}`}
        >
          <Segment colour={SERIES.capital} width={share(principal)} />
          <Segment colour={SERIES.interest} width={share(interest)} />
          {fees > 0 && <Segment colour={SERIES.fees} width={share(fees)} />}
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Figure label={t('lifetimeSplit.principal')} colour={SERIES.capital}>
            <Money amount={totals.principal} currency={loan.currency} whole />
          </Figure>
          <Figure label={t('lifetimeSplit.interest')} colour={SERIES.interest}>
            <Money amount={totals.interest} currency={loan.currency} whole />
          </Figure>
          <Figure label={t('lifetimeSplit.total')}>
            <Money
              amount={add(add(totals.principal, totals.interest), totals.fees)}
              currency={loan.currency}
              whole
            />
          </Figure>
        </dl>
      </div>
    </ChartFrame>
  )
}

function Segment({ colour, width }: { readonly colour: string; readonly width: string }) {
  return (
    <div
      aria-hidden
      className="h-full first:rounded-l-md last:rounded-r-md"
      style={{ backgroundColor: colour, width }}
    />
  )
}

function Figure({
  label,
  colour,
  children,
}: {
  readonly label: string
  readonly colour?: string
  readonly children: React.ReactNode
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {colour !== undefined && (
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: colour }}
          />
        )}
        {label}
      </dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}
