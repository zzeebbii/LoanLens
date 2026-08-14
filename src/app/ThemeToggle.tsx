import type { ThemePreference } from '@/app/theme'

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useSettings } from '@/app/providers/SettingsProvider'
import { THEME_PREFERENCES } from '@/app/theme'
import { Button } from '@/components/ui/button'

const ICONS = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
} as const

/**
 * Cycles light → dark → system.
 *
 * A cycling button rather than a menu: three options is few enough that a single control is
 * quicker, and the icon plus accessible label always says which state it is in.
 */
export function ThemeToggle() {
  const { t } = useTranslation()
  const { settings, update } = useSettings()

  const current = settings.theme as ThemePreference
  const Icon = ICONS[current]
  // Index arithmetic is in range by construction, but `noUncheckedIndexedAccess` cannot see
  // that, and a fallback is cheaper than an assertion.
  const next =
    THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(current) + 1) % THEME_PREFERENCES.length] ??
    'system'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void update({ theme: next })}
      aria-label={`${t('theme.label')}: ${t(`theme.${current}`)}`}
      title={t(`theme.${current}`)}
    >
      <Icon aria-hidden />
    </Button>
  )
}
