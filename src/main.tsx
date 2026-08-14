import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app/App'
import { initI18n } from '@/i18n/config'
import { resolveLocale } from '@/i18n/format'

import '@/styles/index.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root container #root is missing from index.html')
}

/**
 * i18n is initialised before the first render.
 *
 * Rendering first and translating afterwards shows a flash of raw keys, which in a
 * financial app reads as broken. The cost is one await before paint: the English resources
 * are already in the bundle, so there is no network round trip.
 */
const locale = resolveLocale(null)
await initI18n({ locale, debug: import.meta.env.DEV })

document.documentElement.lang = locale

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
