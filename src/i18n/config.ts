import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import charts from '@/i18n/locales/en/charts.json'
import common from '@/i18n/locales/en/common.json'
import errors from '@/i18n/locales/en/errors.json'
import loan from '@/i18n/locales/en/loan.json'
import rates from '@/i18n/locales/en/rates.json'
import scenarios from '@/i18n/locales/en/scenarios.json'
import schedule from '@/i18n/locales/en/schedule.json'
import settings from '@/i18n/locales/en/settings.json'

/**
 * i18n setup.
 *
 * English is the base locale and the fallback. It ships in the bundle because the app is
 * unusable without it, so lazy-loading would only buy a flash of untranslated keys.
 * Additional locales are validated against this key set by `npm run check:i18n`, which
 * fails the build on drift in either direction.
 *
 * Resources are typed from the English JSON, so `t('loan:field.principal')` is checked at
 * compile time and a typo is a type error rather than a raw key rendered on screen.
 */

export const BASE_LOCALE = 'en'

/**
 * Locales the app offers. English only for now; the infrastructure is what matters, and
 * adding a locale is a directory of JSON plus an entry here.
 */
export const SUPPORTED_LOCALES = [BASE_LOCALE] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const NAMESPACES = [
  'common',
  'loan',
  'schedule',
  'scenarios',
  'rates',
  'settings',
  'charts',
  'errors',
] as const

export const DEFAULT_NAMESPACE = 'common'

export const resources = {
  en: { common, loan, schedule, scenarios, rates, settings, charts, errors },
} as const

export interface InitI18nOptions {
  /** Resolved BCP 47 tag. Falls back to English for anything not translated. */
  readonly locale?: string
  /** Turn i18next's own logging on. */
  readonly debug?: boolean
}

export async function initI18n({ locale, debug = false }: InitI18nOptions = {}) {
  await i18next.use(initReactI18next).init({
    resources,
    lng: locale ?? BASE_LOCALE,
    fallbackLng: BASE_LOCALE,
    ns: NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    debug,
    interpolation: {
      // React escapes for us; letting i18next escape as well double-encodes anything the
      // user typed, so an apostrophe in a loan name would render as `&#39;`.
      escapeValue: false,
    },
    returnNull: false,
    // Surface a missing key loudly in development rather than rendering an empty string.
    parseMissingKeyHandler: (key) => (debug ? `⟨${key}⟩` : key),
  })

  return i18next
}

export { default as i18n } from 'i18next'
