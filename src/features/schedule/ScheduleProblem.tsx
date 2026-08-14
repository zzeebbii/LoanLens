import type { ScheduleError } from '@/app/hooks/useSchedule'
import type { Loan } from '@/domain/loan'

import { Link } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ForecastPicker } from '@/features/rates/ForecastPicker'

/**
 * A schedule that could not be produced, explained.
 *
 * These are not crashes — they are the engine declining to guess (ADR 0001) or refusing to
 * emit nonsense. Each one has a cause the user can act on, so each gets its own explanation
 * and, where possible, the control that fixes it right here rather than a link to settings.
 */
export function ScheduleProblem({
  loan,
  error,
}: {
  readonly loan: Loan
  readonly error: ScheduleError
}) {
  const { t } = useTranslation(['errors', 'common', 'rates'] as const)

  if (error.kind === 'MISSING_RATE') {
    return (
      <Card>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>{t('errors:missingRate.title', { period: error.period })}</AlertTitle>
            <AlertDescription>{t('errors:missingRate.body')}</AlertDescription>
          </Alert>
          {/* The fix belongs here, not three clicks away in settings. */}
          <ForecastPicker />
        </CardContent>
      </Card>
    )
  }

  if (error.kind === 'NON_AMORTIZING') {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden />
        <AlertTitle>{t('errors:nonAmortizing.title')}</AlertTitle>
        <AlertDescription>
          <p>{t('errors:nonAmortizing.body')}</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/loans/$loanId/edit" params={{ loanId: loan.id }}>
              {t('common:action.edit')}
            </Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{t('errors:generic.title')}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/loans/$loanId/edit" params={{ loanId: loan.id }}>
            {t('common:action.edit')}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  )
}
