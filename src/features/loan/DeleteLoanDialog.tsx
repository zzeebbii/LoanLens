import { useTranslation } from 'react-i18next'

import { useDeleteLoan } from '@/app/hooks/useLoans'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Confirmation for deleting a loan.
 *
 * Shared rather than duplicated because it is now reachable from two places — the loan's own
 * page and its card in the list — and a confirmation that says something slightly different
 * depending on where it was opened from is a confirmation people stop reading.
 *
 * It names the loan. On the detail page "this loan" was unambiguous; in a list of cards it is
 * not, and the delete cannot be undone. `onDeleted` is the caller's, because the two entry
 * points want different things afterwards: the detail page has to leave a page that no longer
 * exists, while the card simply disappears from the list under it.
 */
export function DeleteLoanDialog({
  loanId,
  loanName,
  open,
  onOpenChange,
  onDeleted,
}: {
  readonly loanId: string
  readonly loanName: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onDeleted?: () => void | Promise<void>
}) {
  const { t } = useTranslation(['common', 'loan'] as const)
  const { mutateAsync: deleteLoan, isPending } = useDeleteLoan()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common:action.close')}>
        <DialogHeader>
          <DialogTitle>{t('common:action.delete')}</DialogTitle>
          <DialogDescription>{t('loan:form.deleteConfirm', { name: loanName })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:action.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={async () => {
              await deleteLoan(loanId)
              await onDeleted?.()
            }}
          >
            {t('common:action.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
