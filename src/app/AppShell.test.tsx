// @vitest-environment jsdom

import { cleanup, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderApp } from '@/app/testing/renderApp'

/**
 * The header, across routes.
 *
 * These exist because the nav previously changed shape depending on where you were: the
 * links were ghost buttons, so they had no visible edge until hovered, and the active route
 * gave one of them a filled background. The same control therefore looked like a button on
 * its own page and like plain text everywhere else — and the fill it used to say "you are
 * here" was the same fill it used for hover.
 *
 * jsdom has no layout and no computed theme, so the assertions are on the class contract and
 * on `aria-current` rather than on pixels. That is the half that can regress silently; the
 * appearance itself needs eyes.
 */
function nav(name: string) {
  return within(screen.getByRole('banner')).getByRole('link', { name })
}

describe('the header nav', () => {
  it('marks the current page for a screen reader, not only visually', async () => {
    await renderApp('/')

    expect(nav('Loans').getAttribute('aria-current')).toBe('page')
    expect(nav('Settings').getAttribute('aria-current')).toBeNull()
  })

  it('moves that mark when the route changes', async () => {
    await renderApp('/settings')

    expect(nav('Settings').getAttribute('aria-current')).toBe('page')
    expect(nav('Loans').getAttribute('aria-current')).toBeNull()
  })

  it('keeps every nav item looking like a control on its own page and away from it', async () => {
    await renderApp('/')
    const onHome = nav('Loans').className

    // Torn down explicitly: two mounted headers would make `getByRole('banner')` ambiguous.
    cleanup()
    await renderApp('/settings')
    const away = nav('Loans').className

    // The border and surface come from the `outline` variant and must not depend on the
    // route. Only the active background may differ.
    for (const className of ['border', 'bg-card']) {
      expect(onHome).toContain(className)
      expect(away).toContain(className)
    }
  })

  it('distinguishes the current page by more than the hover colour', async () => {
    await renderApp('/')

    // `data-active` is what carries the filled state; without it the two states would be
    // told apart only by whether a pointer happened to be over the control.
    expect(nav('Loans').getAttribute('data-active')).toBe('true')
    expect(nav('Settings').getAttribute('data-active')).toBeNull()
  })
})
