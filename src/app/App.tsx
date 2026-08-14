import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useMemo } from 'react'

import { ErrorBoundary } from '@/app/ErrorBoundary'
import { RateProviderRegistryProvider } from '@/app/providers/RateProviderContext'
import { RepositoryProvider } from '@/app/providers/RepositoryProvider'
import { SettingsProvider } from '@/app/providers/SettingsProvider'
import { createAppRouter } from '@/app/router'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * The provider stack, outermost first.
 *
 * Order matters: settings are read through the repository, so the repository has to resolve
 * before settings can load, and both need the query client. The rate registry is
 * independent but is configured with the base path, so it belongs at the top too.
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Loan data changes only when this app changes it, so refetching on focus is noise.
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

/**
 * The app is served from a subdirectory on GitHub Pages, so the router and the snapshot URL
 * both have to be prefixed. Vite injects the value at build time.
 */
const BASE_PATH = import.meta.env.BASE_URL

export function App() {
  const queryClient = useMemo(createQueryClient, [])
  const router = useMemo(() => createAppRouter(BASE_PATH), [])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RateProviderRegistryProvider snapshotUrl={`${BASE_PATH}data/euribor.json`}>
          <RepositoryProvider fallback={<AppLoading />}>
            <SettingsProvider>
              <TooltipProvider delayDuration={300}>
                <RouterProvider router={router} />
              </TooltipProvider>
            </SettingsProvider>
          </RepositoryProvider>
        </RateProviderRegistryProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

function AppLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
