import type { Schedule } from '@/app/hooks/useSchedule'
import type { ScenarioComparison } from '@/domain/analytics'
import type { Loan } from '@/domain/loan'

import { useTranslation } from 'react-i18next'

import { Duration } from '@/components/Duration'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** A saved scenario measured against the baseline. */
export function ComparisonTable({
  loan,
  name,
  comparison,
  baseline,
  scenario,
}: {
  readonly loan: Loan
  readonly name: string
  readonly comparison: ScenarioComparison
  readonly baseline: Schedule
  readonly scenario: Schedule
}) {
  const { t } = useTranslation('scenarios')

  if (baseline.totals === null || scenario.totals === null) return null

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('comparison.title')}</TableHead>
            <TableHead className="text-right">{t('baseline')}</TableHead>
            <TableHead className="text-right">{name}</TableHead>
            <TableHead className="text-right">{t('comparison.difference')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="text-muted-foreground">{t('comparison.payoffDate')}</TableCell>
            <TableCell className="text-right">
              {comparison.baselinePayoffPeriod !== null && (
                <Period period={comparison.baselinePayoffPeriod} format="short" />
              )}
            </TableCell>
            <TableCell className="text-right">
              {comparison.scenarioPayoffPeriod !== null && (
                <Period period={comparison.scenarioPayoffPeriod} format="short" />
              )}
            </TableCell>
            <TableCell className="text-right">
              <Duration months={comparison.monthsSaved} />
            </TableCell>
          </TableRow>

          <TableRow>
            <TableCell className="text-muted-foreground">{t('comparison.totalInterest')}</TableCell>
            <TableCell className="text-right">
              <Money amount={baseline.totals.interest} currency={loan.currency} whole />
            </TableCell>
            <TableCell className="text-right">
              <Money amount={scenario.totals.interest} currency={loan.currency} whole />
            </TableCell>
            <TableCell className="text-right font-medium">
              <Money
                amount={comparison.interestSaved}
                currency={loan.currency}
                whole
                signed
                colourBySign
              />
            </TableCell>
          </TableRow>

          <TableRow>
            <TableCell className="text-muted-foreground">{t('comparison.totalPaid')}</TableCell>
            <TableCell className="text-right">
              <Money amount={baseline.totals.totalPaid} currency={loan.currency} whole />
            </TableCell>
            <TableCell className="text-right">
              <Money amount={scenario.totals.totalPaid} currency={loan.currency} whole />
            </TableCell>
            <TableCell className="text-right font-medium">
              <Money
                amount={comparison.totalSaved}
                currency={loan.currency}
                whole
                signed
                colourBySign
              />
            </TableCell>
          </TableRow>

          <TableRow>
            <TableCell className="text-muted-foreground">{t('comparison.extraPaid')}</TableCell>
            <TableCell className="text-right text-muted-foreground">—</TableCell>
            <TableCell className="text-right">
              <Money amount={comparison.extraPaid} currency={loan.currency} whole />
            </TableCell>
            <TableCell className="text-right text-muted-foreground">—</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
