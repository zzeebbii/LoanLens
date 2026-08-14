import type { LoanDetailSearch } from '@/app/router'

import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDeleteLoan, useLoan } from '@/app/hooks/useLoans'
import { horizonFor, useLoanRates } from '@/app/hooks/useRateSeries'
import { useSchedule } from '@/app/hooks/useSchedule'
import { NotFound } from '@/app/NotFound'
import { useSettings } from '@/app/providers/SettingsProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { yearMonth } from '@/domain/dates'
import { ChartsPanel } from '@/features/charts/ChartsPanel'
import { LoanSummary } from '@/features/loan/LoanSummary'
import { RatesPanel } from '@/features/rates/RatesPanel'
import { ScenariosPanel } from '@/features/scenarios/ScenariosPanel'
import { SchedulePanel } from '@/features/schedule/SchedulePanel'
import { ScheduleProblem } from '@/features/schedule/ScheduleProblem'

const TABS = ['charts', 'schedule', 'scenarios', 'rates'] as const

type TabId = (typeof TABS)[number]

function isTabId(value: string | undefined): value is TabId {
  return value !== undefined && (TABS as readonly string[]).includes(value)
}

export function LoanDetailPage() {
  const { t } = useTranslation([
    'common',
    'loan',
    'schedule',
    'scenarios',
    'rates',
    'charts',
  ] as const)
  const navigate = useNavigate()
  const { loanId } = useParams({ from: '/loans/$loanId' })
  const search = useSearch({ from: '/loans/$loanId' })
  const { settings } = useSettings()

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { data: loan, isPending } = useLoan(loanId)
  const { mutateAsync: deleteLoan } = useDeleteLoan()

  const rates = useLoanRates({
    loan,
    forecast: settings.defaultForecast,
    // A distant sentinel while the loan is still loading; nothing reads it.
    horizon: loan == null ? yearMonth(9999, 12) : horizonFor(loan),
  })
  const schedule = useSchedule({ loan, rateAt: rates.data?.rateAt })

  if (isPending) return <Skeleton className="h-96 w-full" />
  if (loan == null) return <NotFound />

  const activeTab: TabId = isTabId(search.tab) ? search.tab : 'charts'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{loan.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/loans/$loanId/edit" params={{ loanId }}>
              <PencilIcon aria-hidden />
              {t('common:action.edit')}
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            aria-label={t('common:action.delete')}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      </div>

      <LoanSummary
        loan={loan}
        schedule={schedule}
        usedFallback={rates.data?.usedFallback ?? false}
      />

      {schedule !== null && schedule.error !== null ? (
        <ScheduleProblem loan={loan} error={schedule.error} />
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(tab) => {
            void navigate({
              to: '/loans/$loanId',
              params: { loanId },
              search: (previous): LoanDetailSearch => ({ ...previous, tab }),
              replace: true,
            })
          }}
        >
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="charts">{t('charts:capitalVsInterest.title')}</TabsTrigger>
            <TabsTrigger value="schedule">{t('schedule:title')}</TabsTrigger>
            <TabsTrigger value="scenarios">{t('scenarios:title')}</TabsTrigger>
            <TabsTrigger value="rates">{t('rates:title')}</TabsTrigger>
          </TabsList>

          <TabsContent value="charts">
            <ChartsPanel
              loan={loan}
              rows={schedule?.rows ?? null}
              series={rates.data?.series ?? null}
            />
          </TabsContent>
          <TabsContent value="schedule">
            <SchedulePanel loan={loan} rows={schedule?.rows ?? null} />
          </TabsContent>
          <TabsContent value="scenarios">
            <ScenariosPanel loan={loan} rateAt={rates.data?.rateAt} />
          </TabsContent>
          <TabsContent value="rates">
            <RatesPanel
              loan={loan}
              series={rates.data?.series ?? null}
              rows={schedule?.rows ?? null}
            />
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent closeLabel={t('common:action.close')}>
          <DialogHeader>
            <DialogTitle>{t('common:action.delete')}</DialogTitle>
            <DialogDescription>{t('loan:form.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteLoan(loanId)
                await navigate({ to: '/' })
              }}
            >
              {t('common:action.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
