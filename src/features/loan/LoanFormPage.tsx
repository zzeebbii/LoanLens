import type { Loan } from '@/domain/loan'

import { useNavigate, useParams } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useLoan, useSaveLoan } from '@/app/hooks/useLoans'
import { NotFound } from '@/app/NotFound'
import { useSettings } from '@/app/providers/SettingsProvider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { emptyLoanDraft, loanToDraft } from '@/features/loan/loanDraft'
import { LoanForm } from '@/features/loan/LoanForm'

export function LoanFormPage({ mode }: { readonly mode: 'create' | 'edit' }) {
  const { t } = useTranslation(['loan', 'errors'] as const)
  const navigate = useNavigate()
  const { settings } = useSettings()
  const { mutateAsync: saveLoan, error: saveError } = useSaveLoan()

  const params = useParams({ strict: false })
  const loanId = mode === 'edit' ? (params as { loanId?: string }).loanId : undefined
  const { data: existing, isPending } = useLoan(loanId)

  if (mode === 'edit' && isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (mode === 'edit' && existing == null) {
    return <NotFound />
  }

  const handleSubmit = async (loan: Loan) => {
    // A storage write can genuinely fail — a refused quota, storage disabled mid-session. The
    // mutation records the error, which the alert below surfaces; navigating anyway would tell
    // the user their loan was saved when it was not.
    await saveLoan(loan)
    await navigate({ to: '/loans/$loanId', params: { loanId: loan.id } })
  }

  const handleCancel = () => {
    void (mode === 'edit' && loanId !== undefined
      ? navigate({ to: '/loans/$loanId', params: { loanId } })
      : navigate({ to: '/' }))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === 'create' ? t('loan:form.createTitle') : t('loan:form.editTitle')}
      </h1>

      {saveError !== null && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{t('errors:storage.title')}</AlertTitle>
          <AlertDescription>{t('errors:storage.body')}</AlertDescription>
        </Alert>
      )}

      <LoanForm
        defaultValues={existing == null ? emptyLoanDraft(settings) : loanToDraft(existing)}
        submitLabel={mode === 'create' ? t('loan:form.createSubmit') : t('loan:form.editSubmit')}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  )
}
