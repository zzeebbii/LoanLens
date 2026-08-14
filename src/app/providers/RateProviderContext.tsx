import type { RateProviderRegistry } from '@/rates'
import type { ReactNode } from 'react'

import { createContext, use, useMemo } from 'react'

import { createDefaultRegistry } from '@/rates'

/**
 * Supplies the rate-provider registry to the tree.
 *
 * A context rather than a module-level singleton so tests get a clean registry, and so a
 * user-supplied provider can be registered at the app boundary rather than by mutating
 * shared state from somewhere deep in a feature.
 */

const RateProviderContext = createContext<RateProviderRegistry | null>(null)

export interface RateProviderRegistryProviderProps {
  readonly children: ReactNode
  readonly registry?: RateProviderRegistry
  /**
   * Where the bundled snapshot lives. Must respect the app's base path, since GitHub Pages
   * serves the app from a subdirectory.
   */
  readonly snapshotUrl?: string
}

export function RateProviderRegistryProvider({
  children,
  registry,
  snapshotUrl,
}: RateProviderRegistryProviderProps) {
  const value = useMemo(
    () => registry ?? createDefaultRegistry(snapshotUrl === undefined ? {} : { snapshotUrl }),
    [registry, snapshotUrl],
  )

  return <RateProviderContext value={value}>{children}</RateProviderContext>
}

export function useRateProviders(): RateProviderRegistry {
  const context = use(RateProviderContext)
  if (context === null) {
    throw new Error('useRateProviders must be used inside a RateProviderRegistryProvider.')
  }
  return context
}
