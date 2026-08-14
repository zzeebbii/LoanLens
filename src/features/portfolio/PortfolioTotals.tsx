import type { Loan } from '@/domain/loan'

import { useTranslation } from 'react-i18next'

import { Money } from '@/components/Money'
import { Card, CardContent } from '@/components/ui/card'
import { add, sum, ZERO } from '@/domain/money'

/**
 * Totals across every loan.
 *
 * Deliberately limited to figures that are meaningful when added up. A combined *rate* would
 * be a weighted average that misleads, and a combined payoff date would just be the latest
 * one — neither belongs here, so neither is shown.
 *
 * Only rendered when there is more than one loan, since otherwise it repeats the card below
 * it.
 */
export function PortfolioTotals({ loans }: { readonly loans: readonly Loan[] }) {
  const { t } = useTranslation(['common', 'loan'] as const)

  // Loans could in principle be in different currencies. Summing across them would be
  // meaningless, so the totals are shown per currency.
  const byCurrency = new Map<string, Loan[]>()
  for (const loan of loans) {
    byCurrency.set(loan.currency, [...(byCurrency.get(loan.currency) ?? []), loan])
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap gap-x-10 gap-y-4">
        {[...byCurrency.entries()].map(([currency, group]) => (
          <dl key={currency} className="flex flex-wrap gap-x-10 gap-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('loan:summary.borrowed')}</dt>
              <dd className="text-xl font-semibold">
                <Money
                  amount={group.reduce((total, loan) => add(total, loan.principal), ZERO)}
                  currency={currency}
                  whole
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('nav.portfolio')}</dt>
              <dd className="tabular text-xl font-semibold">{group.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('loan:fees.title')}</dt>
              <dd className="text-xl font-semibold">
                <Money
                  amount={sum(group.map((loan) => loan.fees.monthlyServicing))}
                  currency={currency}
                />
              </dd>
            </div>
          </dl>
        ))}
      </CardContent>
    </Card>
  )
}
