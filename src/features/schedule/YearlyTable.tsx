import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Money } from '@/components/Money'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { byYear, totals } from '@/domain/analytics'

/**
 * The schedule rolled up by calendar year.
 *
 * Twenty-five rows instead of three hundred. A year is the unit people actually think in
 * when they ask what the loan is costing them, and it is small enough to read at a glance.
 */
export function YearlyTable({
  loan,
  rows,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[]
}) {
  const { t } = useTranslation(['schedule', 'charts'] as const)
  const years = useMemo(() => byYear(rows), [rows])
  const summary = useMemo(() => totals(rows), [rows])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('charts:byYear.title')}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('charts:axis.year')}</TableHead>
              <TableHead className="text-right">{t('schedule:column.interest')}</TableHead>
              <TableHead className="text-right">{t('schedule:column.capital')}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                {t('schedule:column.fees')}
              </TableHead>
              <TableHead className="text-right">{t('schedule:column.totalPaid')}</TableHead>
              <TableHead className="hidden text-right md:table-cell">
                {t('schedule:column.closingBalance')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((year) => (
              <TableRow key={year.year}>
                <TableCell className="tabular font-medium">{year.year}</TableCell>
                <TableCell className="text-right">
                  <Money amount={year.interest} currency={loan.currency} />
                </TableCell>
                <TableCell className="text-right">
                  <Money amount={year.capital} currency={loan.currency} />
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <Money amount={year.fees} currency={loan.currency} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Money amount={year.totalPaid} currency={loan.currency} />
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Money
                    amount={year.closingBalance}
                    currency={loan.currency}

                    whole
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>{t('schedule:column.totalPaid')}</TableCell>
              <TableCell className="text-right">
                <Money amount={summary.interest} currency={loan.currency} />
              </TableCell>
              <TableCell className="text-right">
                <Money amount={summary.principal} currency={loan.currency} />
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell">
                <Money amount={summary.fees} currency={loan.currency} />
              </TableCell>
              <TableCell className="text-right">
                <Money amount={summary.totalPaid} currency={loan.currency} />
              </TableCell>
              <TableCell className="hidden md:table-cell" />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  )
}
