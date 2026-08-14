import type { Loan } from '@/domain/loan'
import type { LoanEvent, Scenario } from '@/domain/scenario'
import type { ReferenceRateAt } from '@/domain/schedule'

import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDeleteScenario, useSaveScenario, useScenarios } from '@/app/hooks/useLoans'
import { useScenarioComparison } from '@/app/hooks/useSchedule'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ComparisonTable } from '@/features/scenarios/ComparisonTable'
import { EffectComparison } from '@/features/scenarios/EffectComparison'
import { ScenarioEditor } from '@/features/scenarios/ScenarioEditor'

/**
 * Scenarios for one loan.
 *
 * The panel leads with the comparison the whole app is for — shortening the term against
 * lowering the payment for the same overpayment — because that is the question a borrower
 * actually has, and it needs no setup. Saved scenarios come after, for anything more
 * specific.
 */
export function ScenariosPanel({
  loan,
  rateAt,
}: {
  readonly loan: Loan
  readonly rateAt: ReferenceRateAt | undefined
}) {
  const { t } = useTranslation(['scenarios', 'common'] as const)
  const { data: scenarios, isPending } = useScenarios(loan.id)
  const { mutateAsync: saveScenario } = useSaveScenario()
  const { mutateAsync: deleteScenario } = useDeleteScenario(loan.id)

  const [editing, setEditing] = useState<Scenario | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Deleting a scenario throws away work that took real thought to set up, so it asks first.
  const [deleting, setDeleting] = useState<Scenario | null>(null)

  const selected = scenarios?.find((scenario) => scenario.id === selectedId) ?? null

  const events: readonly LoanEvent[] = useMemo(() => selected?.events ?? [], [selected])
  const comparison = useScenarioComparison({ loan, rateAt, events })

  if (isPending) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-6">
      <EffectComparison loan={loan} rateAt={rateAt} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t('scenarios:title')}</CardTitle>
              <CardDescription>{t('scenarios:subtitle')}</CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() =>
                setEditing({
                  id: crypto.randomUUID(),
                  loanId: loan.id,
                  name: '',
                  events: [],
                  createdAt: new Date().toISOString(),
                })
              }
            >
              <PlusIcon aria-hidden />
              {t('scenarios:create')}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {scenarios === undefined || scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('scenarios:event.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {scenarios.map((scenario) => (
                <li
                  key={scenario.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(selectedId === scenario.id ? null : scenario.id)}
                    className="mr-auto rounded-sm text-left text-sm font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    aria-pressed={selectedId === scenario.id}
                  >
                    {scenario.name}
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(scenario)}>
                    {t('common:action.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common:action.delete')}
                    onClick={() => setDeleting(scenario)}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {selected !== null && comparison !== null && comparison.comparison !== null && (
            <ComparisonTable
              loan={loan}
              name={selected.name}
              comparison={comparison.comparison}
              baseline={comparison.baseline}
              scenario={comparison.scenario}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent closeLabel={t('common:action.close')}>
          <DialogHeader>
            <DialogTitle>{t('common:action.delete')}</DialogTitle>
            <DialogDescription>{t('scenarios:deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const target = deleting
                setDeleting(null)
                if (target === null) return
                if (selectedId === target.id) setSelectedId(null)
                await deleteScenario(target.id)
              }}
            >
              {t('common:action.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing !== null && (
        <ScenarioEditor
          loan={loan}
          scenario={editing}
          onCancel={() => setEditing(null)}
          onSave={async (scenario) => {
            await saveScenario(scenario)
            setSelectedId(scenario.id)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
