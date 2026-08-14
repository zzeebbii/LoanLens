import type { DEFAULT_NAMESPACE, resources } from '@/i18n/config'

/**
 * Types every translation key from the English resources.
 *
 * With this in place `t('loan:field.principal')` is checked at compile time, so a typo or
 * a key removed during a rename is a build failure rather than a raw key string rendered
 * on screen. `npm run check:i18n` covers the other direction — keys defined but never used,
 * and locales that have drifted out of step.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE
    resources: (typeof resources)['en']
    returnNull: false
  }
}
