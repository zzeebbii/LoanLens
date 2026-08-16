import type { YearMonth } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { PaymentFlag, PaymentRow } from '@/domain/schedule'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { Rate } from '@/components/Rate'
import { Badge } from '@/components/ui/badge'
import { totals } from '@/domain/analytics'
import { isPositive } from '@/domain/money'
import { cn } from '@/lib/cn'

/**
 * The full payment schedule.
 *
 * Virtualised because a 30-year loan is 360 rows and every row renders several formatted
 * amounts; rendering them all makes filtering and tab switching visibly janky.
 *
 * A CSS grid rather than a `<table>`, with explicit ARIA table roles. Virtualisation needs
 * absolutely-positioned rows, which a real `<tbody>` will not do — the roles keep it a table
 * to a screen reader regardless.
 *
 * Below `sm` the layout collapses to one card per month: a twelve-column money table on a
 * phone is unreadable however much it scrolls.
 */

/**
 * The column layout, in one place.
 *
 * Header, body and totals have to agree exactly or the figures sit under the wrong headings.
 * They are separate elements because the body is virtualised and the other two must not be,
 * which is precisely the arrangement where three copies of a template silently drift apart.
 */
const GRID_TEMPLATE = 'sm:grid-cols-[3rem_6rem_4.5rem_repeat(4,minmax(0,1fr))_7rem]'

const ROW_HEIGHT = 44

/**
 * Flags worth a badge in the table. The rest are either implied or too noisy per-row.
 *
 * A Set because this is membership-tested for every flag on every visible row.
 */
const NOTABLE_FLAGS: ReadonlySet<PaymentFlag> = new Set([
  'RATE_RESET',
  'PAYMENT_HOLIDAY',
  'EXTRA_PAYMENT',
  'BALANCE_CORRECTED',
  'NEGATIVE_AMORTIZATION',
  'FINAL_PAYMENT',
])

const FLAG_VARIANT: Partial<
  Record<PaymentFlag, 'secondary' | 'warning' | 'success' | 'destructive'>
> = {
  RATE_RESET: 'secondary',
  PAYMENT_HOLIDAY: 'warning',
  EXTRA_PAYMENT: 'success',
  BALANCE_CORRECTED: 'secondary',
  NEGATIVE_AMORTIZATION: 'destructive',
  FINAL_PAYMENT: 'secondary',
}

export function ScheduleTable({
  loan,
  rows,
  asOf,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
  readonly asOf: YearMonth
}) {
  const { t } = useTranslation('schedule')
  const scrollRef = useRef<HTMLDivElement>(null)

  /*
   * Totals of the rows actually shown, not of the whole loan.
   *
   * The panel above filters to past or future instalments, so a footer summing the full
   * schedule would sit under a filtered table contradicting it. "Everything you can see adds
   * up to this" is the only reading that stays true whatever the filter is set to, and it is
   * the more useful one — what the past has cost, or what the rest will.
   */
  const shown = useMemo(() => totals(rows), [rows])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  return (
    <div
      ref={scrollRef}
      className="max-h-[32rem] overflow-auto"
      role="table"
      aria-rowcount={rows.length}
      aria-label={t('title')}
    >
      {/* Header. Hidden below `sm`, where each row becomes its own labelled card. */}
      <div
        role="row"
        className={cn(
          'sticky top-0 z-10 hidden border-b bg-card/95 backdrop-blur-sm sm:grid sm:gap-2 sm:px-4 sm:py-2',
          GRID_TEMPLATE,
        )}
      >
        <ColumnHeader className="text-right">{t('column.index')}</ColumnHeader>
        <ColumnHeader>{t('column.period')}</ColumnHeader>
        <ColumnHeader className="text-right">{t('column.rate')}</ColumnHeader>
        <ColumnHeader className="text-right">{t('column.interest')}</ColumnHeader>
        <ColumnHeader className="text-right">{t('column.capital')}</ColumnHeader>
        <ColumnHeader className="text-right">{t('column.totalPaid')}</ColumnHeader>
        <ColumnHeader className="text-right">{t('column.closingBalance')}</ColumnHeader>
        <ColumnHeader>{''}</ColumnHeader>
      </div>

      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (row === undefined) return null

          return (
            <div
              key={row.index}
              role="row"
              aria-rowindex={row.index}
              className={cn(
                'absolute top-0 left-0 w-full border-b px-4 py-2 text-sm',
                'grid grid-cols-2 gap-x-3 gap-y-1',
                GRID_TEMPLATE,
                'sm:items-center sm:gap-2',
                row.period === asOf && 'bg-accent/40',
              )}
              style={{ height: ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}
            >
              <Cell className="hidden text-right text-muted-foreground sm:block">{row.index}</Cell>

              <Cell className="font-medium sm:font-normal">
                <Period period={row.period} format="short" />
              </Cell>

              <Cell className="text-right">
                <Rate value={row.annualRate} decimals={2} />
              </Cell>

              <MoneyCell label={t('column.interest')} className="text-right">
                <Money amount={row.interest} currency={loan.currency} />
              </MoneyCell>

              <MoneyCell label={t('column.capital')} className="text-right">
                <Money amount={row.capital} currency={loan.currency} />
              </MoneyCell>

              <MoneyCell label={t('column.totalPaid')} className="text-right font-medium">
                <Money amount={row.totalPaid} currency={loan.currency} />
              </MoneyCell>

              <MoneyCell label={t('column.closingBalance')} className="text-right">
                <Money amount={row.closingBalance} currency={loan.currency} whole />
              </MoneyCell>

              <Cell className="col-span-2 flex flex-wrap gap-1 sm:col-span-1">
                {isPositive(row.extraPayment) && (
                  <Badge variant="success" className="text-[10px]">
                    <Money amount={row.extraPayment} currency={loan.currency} whole />
                  </Badge>
                )}
                {row.flags
                  .filter((flag) => NOTABLE_FLAGS.has(flag) && flag !== 'EXTRA_PAYMENT')
                  .map((flag) => (
                    <Badge
                      key={flag}
                      variant={FLAG_VARIANT[flag] ?? 'secondary'}
                      className="text-[10px]"
                    >
                      {t(`flag.${flag}`)}
                    </Badge>
                  ))}
              </Cell>
            </div>
          )
        })}
      </div>

      {/* Outside the virtualiser: it is one row and must not scroll out of reach. */}
      <div
        role="row"
        className={cn(
          'sticky bottom-0 z-10 border-t bg-card/95 px-4 py-2 text-sm backdrop-blur-sm',
          'grid grid-cols-2 gap-x-3 gap-y-1',
          GRID_TEMPLATE,
          'sm:items-center sm:gap-2',
        )}
      >
        <Cell className="hidden sm:block">{''}</Cell>
        <Cell className="font-medium">{t('column.total', { count: shown.periods })}</Cell>
        <Cell className="hidden sm:block">{''}</Cell>

        <MoneyCell label={t('column.interest')} className="text-right font-medium">
          <Money amount={shown.interest} currency={loan.currency} />
        </MoneyCell>

        <MoneyCell label={t('column.capital')} className="text-right font-medium">
          <Money amount={shown.principal} currency={loan.currency} />
        </MoneyCell>

        <MoneyCell label={t('column.totalPaid')} className="text-right font-medium">
          <Money amount={shown.totalPaid} currency={loan.currency} />
        </MoneyCell>

        {/* A closing balance is a position, not a flow: adding them up means nothing. */}
        <Cell className="hidden sm:block">{''}</Cell>
        <Cell className="hidden sm:block">{''}</Cell>
      </div>
    </div>
  )
}

function ColumnHeader({
  children,
  className,
}: {
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <div role="columnheader" className={cn('text-xs font-medium text-muted-foreground', className)}>
      {children}
    </div>
  )
}

function Cell({
  children,
  className,
}: {
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <div role="cell" className={cn('truncate', className)}>
      {children}
    </div>
  )
}

/**
 * A money cell that carries its own label below `sm`.
 *
 * Once the header is hidden, an unlabelled column of numbers is meaningless — so each value
 * states what it is on narrow screens.
 */
function MoneyCell({
  label,
  children,
  className,
}: {
  readonly label: string
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <div role="cell" className={cn('truncate', className)}>
      <span className="mr-1 text-xs text-muted-foreground sm:hidden">{label}</span>
      {children}
    </div>
  )
}
