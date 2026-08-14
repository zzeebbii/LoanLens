import type { ErrorInfo, ReactNode } from 'react'

import { Component } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Catches render errors so a bug in one component does not blank the whole app.
 *
 * Deliberately *not* where expected failures land. A missing rate or a loan that cannot
 * amortise are outcomes of user input, handled inline by `ScheduleProblem` with the control
 * that fixes them. Anything reaching here is a genuine defect, so it says so plainly and
 * offers a reload rather than pretending to be recoverable.
 *
 * A class component because error boundaries have no hook equivalent, and `withTranslation`
 * because a class cannot call `useTranslation`.
 */
interface ErrorBoundaryState {
  readonly error: Error | null
}

class ErrorBoundaryInner extends Component<
  WithTranslation<['errors']> & { children: ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only place this can go: there is no backend to report to, and
    // sending it anywhere would break the promise that nothing leaves the device.
    console.error('Unhandled error while rendering', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    const { t, children } = this.props

    if (error === null) return children

    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert variant="destructive">
          <AlertTitle>{t('errors:generic.title')}</AlertTitle>
          <AlertDescription>
            <p>{t('errors:generic.body')}</p>
            <p className="font-mono text-xs">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                globalThis.location.reload()
              }}
            >
              {t('errors:generic.recover')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
}

export const ErrorBoundary = withTranslation(['errors'] as const)(ErrorBoundaryInner)
