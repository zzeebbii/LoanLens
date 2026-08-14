import type { LoanRepository } from '@/persistence'
import type { ReactNode } from 'react'

import { createContext, use, useEffect, useState } from 'react'

import { resolveRepository } from '@/persistence'

/**
 * Supplies the repository to the tree.
 *
 * Injected rather than imported directly so a test — or a future storage backend — can
 * substitute an implementation without touching a single feature component.
 *
 * `ephemeral` is surfaced deliberately: when persistent storage is unavailable the app still
 * works, but the user must be told their data will not survive a reload rather than
 * discovering it afterwards.
 */

export interface RepositoryContextValue {
  readonly repository: LoanRepository
  readonly ephemeral: boolean
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null)

export interface RepositoryProviderProps {
  readonly children: ReactNode
  /** Supply a repository directly to skip detection. Used by tests. */
  readonly value?: RepositoryContextValue
  readonly fallback?: ReactNode
}

export function RepositoryProvider({ children, value, fallback = null }: RepositoryProviderProps) {
  const [resolved, setResolved] = useState<RepositoryContextValue | null>(value ?? null)

  useEffect(() => {
    if (value !== undefined) return

    let cancelled = false

    const detect = async () => {
      const result = await resolveRepository()
      if (!cancelled) setResolved(result)
    }

    void detect()

    return () => {
      cancelled = true
    }
  }, [value])

  if (resolved === null) return <>{fallback}</>

  return <RepositoryContext value={resolved}>{children}</RepositoryContext>
}

export function useRepositoryContext(): RepositoryContextValue {
  const context = use(RepositoryContext)
  if (context === null) {
    throw new Error('useRepositoryContext must be used inside a RepositoryProvider.')
  }
  return context
}

export function useRepository(): LoanRepository {
  return useRepositoryContext().repository
}
