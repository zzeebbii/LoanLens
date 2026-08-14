import type { LoanRepository } from '@/persistence'
import type { RateProvider } from '@/rates'
import type { ReactElement, ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { RateProviderRegistryProvider } from '@/app/providers/RateProviderContext'
import { RepositoryProvider } from '@/app/providers/RepositoryProvider'
import { SettingsProvider } from '@/app/providers/SettingsProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { yearMonth } from '@/domain/dates'
import { NAMESPACES, resources } from '@/i18n/config'
import { InMemoryLoanRepository } from '@/persistence'
import { RateProviderRegistry } from '@/rates'

/**
 * Renders a component inside the app's real provider stack.
 *
 * The whole stack, with only the two edges replaced: storage becomes in-memory, and rate data
 * comes from a fixed series instead of the network. Everything between — settings, i18n,
 * query caching, the engine — is the production code path, which is the point. A test that
 * stubs the middle proves nothing about the app.
 */

/** A rate provider with a fixed series. Enough to drive a floating-rate loan deterministically. */
export function stubRateProvider(ratePercent = 2.855, id = 'ecb'): RateProvider {
  return {
    id,
    labelKey: 'rates:provider.ecb.label',
    supportedTenors: ['1M', '3M', '6M', '12M'],
    earliestPeriod: yearMonth(1999, 1),
    requiresNetwork: false,
    getSeries: ({ tenor }) =>
      Promise.resolve({
        providerId: id,
        tenor,
        points: [{ period: yearMonth(1999, 1), rate: ratePercent / 100 }],
        retrievedAt: '2026-08-01T00:00:00.000Z',
      }),
  }
}

export interface RenderAppOptions {
  readonly repository?: LoanRepository
  readonly rateProvider?: RateProvider
}

/** i18next is a singleton; initialise it once for the whole test run. */
async function ensureI18n() {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources,
      lng: 'en',
      fallbackLng: 'en',
      ns: NAMESPACES,
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      returnNull: false,
    })
  }
}

export async function renderWithProviders(ui: ReactElement, options: RenderAppOptions = {}) {
  await ensureI18n()

  const repository = options.repository ?? new InMemoryLoanRepository()
  const registry = new RateProviderRegistry().register(options.rateProvider ?? stubRateProvider())

  const queryClient = new QueryClient({
    defaultOptions: {
      // Retries turn a genuine failure into a slow test that eventually fails for the wrong
      // reason, and a shared cache leaks state between cases.
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RateProviderRegistryProvider registry={registry}>
          <RepositoryProvider value={{ repository, ephemeral: false }}>
            <SettingsProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </SettingsProvider>
          </RepositoryProvider>
        </RateProviderRegistryProvider>
      </QueryClientProvider>
    )
  }

  return { repository, queryClient, ...render(ui, { wrapper: Wrapper }) }
}
