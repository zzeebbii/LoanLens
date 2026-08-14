/**
 * Translating a key that is only known at runtime.
 *
 * Most keys in this app are literals, checked at compile time against the English resources
 * — that is what `src/i18n/i18next.d.ts` buys. A few genuinely cannot be:
 *
 *  - a rate provider's `labelKey`, since a user-supplied provider brings its own
 *  - a validation message produced by a Zod schema, which has no access to the key union
 *
 * No cast is needed. i18next's own types accept an arbitrary string key *provided* a
 * `defaultValue` is supplied, which is exactly the right contract here: if the key turns out
 * to be missing, the key itself is rendered rather than an empty string, so the gap is
 * visible instead of silent.
 *
 * The safety net is `npm run check:i18n`, which fails on any key referenced but not defined.
 */
export interface DynamicTranslator {
  (key: string, options: { defaultValue: string }): string
}

export function translateDynamic(t: DynamicTranslator, key: string): string {
  return t(key, { defaultValue: key })
}
