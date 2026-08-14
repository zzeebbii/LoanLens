import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { AppShell } from '@/app/AppShell'
import { NotFound } from '@/app/NotFound'
import { LoanDetailPage } from '@/features/loan/LoanDetailPage'
import { LoanFormPage } from '@/features/loan/LoanFormPage'
import { PortfolioPage } from '@/features/portfolio/PortfolioPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

/**
 * Routes, defined in code rather than generated from files.
 *
 * The app has six routes. A codegen step and a watcher would be more machinery than the
 * routing needs, and this file doubles as a readable map of the whole app.
 */

export interface LoanDetailSearch {
  tab?: string
  scenario?: string
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFound,
})

const portfolioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: PortfolioPage,
})

const newLoanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/loans/new',
  component: () => <LoanFormPage mode="create" />,
})

const loanDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/loans/$loanId',
  component: LoanDetailPage,
  /**
   * Which tab is open lives in the URL, so a view is linkable and survives a refresh.
   *
   * The keys are *optional* rather than present-but-undefined. With
   * `exactOptionalPropertyTypes` the difference is load-bearing: present-but-undefined makes
   * TanStack treat `search` as required on every `Link` to this route, so linking to a loan
   * would need `search={{ tab: undefined, scenario: undefined }}` at every call site.
   */
  validateSearch: (search: Record<string, unknown>): LoanDetailSearch => {
    const result: LoanDetailSearch = {}
    if (typeof search['tab'] === 'string') result.tab = search['tab']
    if (typeof search['scenario'] === 'string') result.scenario = search['scenario']
    return result
  },
})

const editLoanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/loans/$loanId/edit',
  component: () => <LoanFormPage mode="edit" />,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  portfolioRoute,
  newLoanRoute,
  loanDetailRoute,
  editLoanRoute,
  settingsRoute,
])

export function createAppRouter(basePath: string) {
  return createRouter({
    routeTree,
    // GitHub Pages serves the app from a subdirectory, so every route has to be prefixed.
    basepath: basePath,
    defaultPreload: 'intent',
    scrollRestoration: true,
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}

export { editLoanRoute, loanDetailRoute, newLoanRoute, portfolioRoute, settingsRoute }
