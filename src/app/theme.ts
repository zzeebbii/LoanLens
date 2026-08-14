/**
 * Theme handling. Deliberately framework-free so it can run from the inline
 * bootstrap script in index.html as well as from React.
 *
 * The storage key is duplicated in index.html — keep both in sync.
 */

export const THEME_STORAGE_KEY = 'loanlens.theme'

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** The theme actually painted, once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark'

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/** Reads the stored preference, defaulting to `system`. Never throws. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return prefersDark() ? 'dark' : 'light'
  }
  return preference
}

/** Persists the preference and applies the resolved theme to <html>. */
export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved

  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage disabled (private mode). The theme still applies for this session.
  }

  return resolved
}
