import { Link, Outlet } from '@tanstack/react-router'
import { LandmarkIcon, SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useRepositoryContext } from '@/app/providers/RepositoryProvider'
import { ThemeToggle } from '@/app/ThemeToggle'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * The frame every screen renders inside.
 *
 * Mobile-first: the header collapses to icons and the content column is padded rather than
 * fixed-width, so a payment table has the whole viewport on a phone.
 */
export function AppShell() {
  const { t } = useTranslation(['common', 'settings'] as const)
  const { ephemeral } = useRepositoryContext()

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-md"
      >
        {t('nav.skipToContent')}
      </a>

      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
          <Link
            to="/"
            className="mr-auto flex items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <LandmarkIcon className="size-5 text-primary" aria-hidden />
            {/* The product name is a proper noun and is not translated. */}
            LoanLens
          </Link>

          {/*
           * Both destinations wear `outline`, so a nav item looks like a control on every
           * page rather than only on its own. As ghost buttons they were invisible until
           * hovered and picked up a background when their route was active — which meant the
           * same control read as a button on one page and as plain text on the next, and the
           * "you are here" state was indistinguishable from a hover.
           *
           * The current page is now said twice over: `aria-current` for a screen reader, and
           * a filled background on a shape that was already button-shaped.
           */}
          <Button asChild variant="outline" size="sm">
            <Link
              to="/"
              activeProps={{ 'data-active': 'true', 'aria-current': 'page' }}
              className="data-active:bg-accent data-active:text-accent-foreground"
            >
              {t('nav.portfolio')}
            </Link>
          </Button>

          <ThemeToggle />

          <Button asChild variant="outline" size="icon" aria-label={t('nav.settings')}>
            <Link
              to="/settings"
              activeProps={{ 'data-active': 'true', 'aria-current': 'page' }}
              className="data-active:bg-accent data-active:text-accent-foreground"
            >
              <SettingsIcon aria-hidden />
            </Link>
          </Button>
        </div>
      </header>

      {ephemeral && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
          <Alert variant="warning">
            <AlertTitle>{t('storage.ephemeralTitle')}</AlertTitle>
            <AlertDescription>{t('storage.ephemeralBody')}</AlertDescription>
          </Alert>
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto w-full max-w-7xl px-4 text-xs text-muted-foreground sm:px-6">
          <p>{t('settings:about.disclaimer')}</p>
          <p className="mt-1">{t('settings:about.rateSource')}</p>
        </div>
      </footer>
    </div>
  )
}
