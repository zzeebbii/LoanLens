import { describe, expect, it } from 'vitest'

import { prefersDark, resolveTheme, THEME_PREFERENCES } from '@/app/theme'

describe('resolveTheme', () => {
  it('passes explicit preferences straight through', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('falls back to light when no media-query support is available', () => {
    // In a non-browser environment `matchMedia` is absent. Theme resolution must
    // degrade to a readable default rather than throwing during module init.
    expect(prefersDark()).toBe(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('resolves every declared preference to a paintable theme', () => {
    for (const preference of THEME_PREFERENCES) {
      expect(['light', 'dark']).toContain(resolveTheme(preference))
    }
  })
})
