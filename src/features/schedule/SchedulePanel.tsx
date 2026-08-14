import type { Loan } from '@/domain/loan'
import type { PaymentRow } from '@/domain/schedule'

import { InfoIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { Period } from '@/components/Period'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { crossoverPeriod } from '@/domain/analytics'
import { compareYearMonth } from '@/domain/dates'
import { ScheduleTable } from '@/features/schedule/ScheduleTable'
import { YearlyTable } from '@/features/schedule/YearlyTable'

const FILTERS = ['all', 'past', 'future'] as const

type Filter = (typeof FILTERS)[number]

export function SchedulePanel({
  loan,
  rows,
}: {
  readonly loan: Loan
  readonly rows: readonly PaymentRow[] | null
}) {
  const { t } = useTranslation(['schedule', 'common'] as const)
  const asOf = useCurrentPeriod()
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    if (rows === null) return null
    if (filter === 'past') return rows.filter((row) => compareYearMonth(row.period, asOf) <= 0)
    if (filter === 'future') return rows.filter((row) => compareYearMonth(row.period, asOf) > 0)
    return rows
  }, [rows, filter, asOf])

  const crossover = useMemo(() => (rows === null ? null : crossoverPeriod(rows)), [rows])

  if (rows === null || filtered === null) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList>
            {FILTERS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`schedule:tab.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-sm text-muted-foreground">
          {t('schedule:rowCount', { count: filtered.length })}
        </p>
      </div>

      {crossover !== null && (
        <Alert variant="info">
          <InfoIcon aria-hidden />
          <AlertDescription>
            {/* Interpolating a component keeps the date locale-formatted inside a sentence. */}
            {t('schedule:note.crossover', { period: '' })}
            <Period period={crossover} />
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <InfoIcon aria-hidden />
        <AlertDescription>{t('schedule:note.reconstructed')}</AlertDescription>
      </Alert>

      <Card className="py-0">
        <CardContent className="px-0">
          <ScheduleTable loan={loan} rows={filtered} asOf={asOf} />
        </CardContent>
      </Card>

      <YearlyTable loan={loan} rows={rows} />

      <p className="text-xs text-muted-foreground">{t('schedule:note.finalAdjustment')}</p>
    </div>
  )
}
