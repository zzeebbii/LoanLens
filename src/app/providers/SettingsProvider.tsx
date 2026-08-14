import type { ThemePreference } from '@/app/theme'
import type { AppSettings } from '@/persistence'
import type { ReactNode } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useRepository } from '@/app/providers/RepositoryProvider'
import { applyThemePreference } from '@/app/theme'
import { resolveLocale } from '@/i18n/format'
import { DEFAULT_SETTINGS } from '@/persistence'

/**
 * Application settings, read from and written to storage.
 *
 * Also the single place where a settings change is applied to the world outside React —
 * the theme class on `<html>`, the `lang` attribute, and i18next's active language. Spread
 * across components, those side effects drift out of step with the stored value.
 */

export interface SettingsContextValue {
  readonly settings: AppSettings
  readonly locale: string
  update: (patch: Partial<AppSettings>) => Promise<void>
  readonly isSaving: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export const SETTINGS_QUERY_KEY = ['settings'] as const

export function SettingsProvider({ children }: { readonly children: ReactNode }) {
  const repository = useRepository()
  const queryClient = useQueryClient()
  const { i18n } = useTranslation()

  const { data: settings = DEFAULT_SETTINGS } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => repository.getSettings(),
    // Settings only change through this provider, so there is nothing to go stale against.
    staleTime: Number.POSITIVE_INFINITY,
  })

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (next: AppSettings) => repository.saveSettings(next),
    onSuccess: (_result, next) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, next)
    },
  })

  const locale = useMemo(() => resolveLocale(settings.locale), [settings.locale])

  // Applied as an effect rather than during the mutation so the DOM also follows a value
  // loaded from storage on a cold start, not only a value the user just changed.
  useEffect(() => {
    applyThemePreference(settings.theme as ThemePreference)
  }, [settings.theme])

  useEffect(() => {
    document.documentElement.lang = locale
    if (i18n.language !== locale) void i18n.changeLanguage(locale)
  }, [locale, i18n])

  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      await mutateAsync({ ...settings, ...patch })
    },
    [mutateAsync, settings],
  )

  const value = useMemo(
    () => ({ settings, locale, update, isSaving: isPending }),
    [settings, locale, update, isPending],
  )

  return <SettingsContext value={value}>{children}</SettingsContext>
}

export function useSettings(): SettingsContextValue {
  const context = use(SettingsContext)
  if (context === null) {
    throw new Error('useSettings must be used inside a SettingsProvider.')
  }
  return context
}

/**
 * The locale for formatting. Available on its own because nearly every component that
 * shows a number needs it and nothing else from settings.
 */
export function useLocale(): string {
  return useSettings().locale
}
