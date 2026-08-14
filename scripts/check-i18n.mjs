#!/usr/bin/env node
/**
 * i18n guard.
 *
 * Requirement: nothing user-facing is hardcoded. Two failure modes matter, and
 * both are silent without a check:
 *
 *   1. A translation key is referenced in code but missing from the base locale,
 *      so the UI renders a raw key string.
 *   2. A non-base locale drifts out of sync with the base locale, so a
 *      translated build silently falls back to English in places nobody noticed.
 *
 * Unused keys are reported as warnings only — some keys are built dynamically
 * (e.g. enum labels) and cannot be traced statically.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const LOCALES_DIR = path.join(SRC, 'i18n', 'locales')
const BASE_LOCALE = 'en'
/** Must match `defaultNS` in src/i18n/config.ts. */
const DEFAULT_NAMESPACE = 'common'

/**
 * Key groups assembled at runtime, which a static scan cannot see.
 *
 * Every one of these is written as `t(\`prefix.${value}\`)` over a domain enum — flags,
 * day-count conventions, tenors — plus the validation messages the Zod schemas in
 * `features/loan/loanDraft.ts` emit as key strings. None appear as a literal inside a `t()`
 * call, so a static scan cannot find them.
 *
 * Matching these exempts them from the unused-key report without weakening the check that
 * matters: a *referenced* key that does not exist is still an error.
 */
const DYNAMIC_KEY_GROUPS =
  /(?:^|\.)(?:flag|dayCount|rounding|amortization|effect|event|holiday|tenor|forecast|provider|theme|tab|validation)\./

/**
 * The suffixes i18next appends to resolve a plural form.
 *
 * `t('units.months', { count })` reads `units.months` or `units.months_other` depending on
 * the count and the locale's plural rules, so only the base key ever appears in code.
 */
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/

/** Matches t('key'), t("key"), i18nKey="key" and tKey: 'key'. */
const KEY_USAGE_RE =
  /\bt\(\s*['"]([\w.:-]+)['"]|i18nKey\s*=\s*['"]([\w.:-]+)['"]|\btKey\s*:\s*['"]([\w.:-]+)['"]/g

/**
 * Strips comments so documentation is not mistaken for a call site.
 *
 * Doc comments in this codebase quote example calls like `t('loan:field.principal')`, and
 * counting those as usage made every other key look unused.
 *
 * Line comments are only stripped when they begin a line, so a `//` inside a URL string
 * survives. The tradeoff is deliberate: over-stripping could hide a real call and let an
 * undefined key through, which is the failure that matters here.
 */
function stripComments(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^[ \t]*\/\/.*$/gm, '')
}

/** @returns {Promise<string[]>} */
async function listDirectories(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Flattens a nested resource object into dotted `namespace:a.b.c` keys. */
function flatten(object, namespace, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(object)) {
    const composed = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, namespace, composed, out)
    } else {
      out.add(`${namespace}:${composed}`)
    }
  }
  return out
}

/** Loads every namespace file for one locale into a flat key set. */
async function loadLocale(locale) {
  const dir = path.join(LOCALES_DIR, locale)
  const keys = new Set()

  let files
  try {
    files = await readdir(dir)
  } catch {
    return keys
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const namespace = path.basename(file, '.json')
    const raw = await readFile(path.join(dir, file), 'utf8')

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`${path.relative(ROOT, path.join(dir, file))} is not valid JSON`, {
        cause: error,
      })
    }

    flatten(parsed, namespace, '', keys)
  }

  return keys
}

/** @returns {Promise<string[]>} */
async function collectSourceFiles(dir) {
  const found = []

  async function walk(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'locales') continue
        await walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(full)
      }
    }
  }

  await walk(dir)
  return found
}

/** Matches the namespace argument of `useTranslation(...)` / `withTranslation(...)`. */
const NAMESPACE_DECLARATION = /(?:useTranslation|withTranslation)\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g

/**
 * The namespace an unprefixed key in this file resolves to.
 *
 * i18next resolves a bare key against the *first* namespace passed to `useTranslation`, not
 * against the global default. Assuming `common` everywhere reported dozens of false failures
 * for components that correctly write `t('title')` under `useTranslation('schedule')`.
 *
 * Falls back to `common`, which is the configured `defaultNS`, when a file references keys
 * without declaring a namespace at all.
 */
function defaultNamespaceFor(source) {
  const match = NAMESPACE_DECLARATION.exec(source)
  NAMESPACE_DECLARATION.lastIndex = 0
  if (!match?.[1]) return DEFAULT_NAMESPACE

  const first = /['"]([^'"]+)['"]/.exec(match[1])
  return first?.[1] ?? DEFAULT_NAMESPACE
}

/** Normalises a used key to `namespace:key` form. */
function normaliseKey(key, fileNamespace) {
  return key.includes(':') ? key : `${fileNamespace}:${key}`
}

async function main() {
  const locales = await listDirectories(LOCALES_DIR)

  if (locales.length === 0) {
    console.log('· No locales present yet — skipping i18n check.')
    return
  }

  if (!locales.includes(BASE_LOCALE)) {
    console.error(
      `✖ Base locale "${BASE_LOCALE}" is missing from ${path.relative(ROOT, LOCALES_DIR)}.`,
    )
    process.exit(1)
  }

  const baseKeys = await loadLocale(BASE_LOCALE)
  const errors = []
  const warnings = []

  // 1. Every non-base locale must cover exactly the base key set.
  for (const locale of locales) {
    if (locale === BASE_LOCALE) continue
    const localeKeys = await loadLocale(locale)

    for (const key of baseKeys) {
      if (!localeKeys.has(key)) errors.push(`${locale}: missing key "${key}"`)
    }
    for (const key of localeKeys) {
      if (!baseKeys.has(key)) errors.push(`${locale}: unknown key "${key}" (not in ${BASE_LOCALE})`)
    }
  }

  // 2. Every statically-referenced key must exist in the base locale.
  const usedKeys = new Set()
  for (const file of await collectSourceFiles(SRC)) {
    const source = stripComments(await readFile(file, 'utf8'))
    const fileNamespace = defaultNamespaceFor(source)

    for (const match of source.matchAll(KEY_USAGE_RE)) {
      const key = match[1] ?? match[2] ?? match[3]
      if (!key) continue
      const normalised = normaliseKey(key, fileNamespace)
      usedKeys.add(normalised)
      if (!baseKeys.has(normalised)) {
        errors.push(
          `${path.relative(ROOT, file)}: uses key "${normalised}" not defined in ${BASE_LOCALE}`,
        )
      }
    }
  }

  // 3. Unused base keys are a warning, not a failure.
  //
  // Skipped entirely when no key is referenced anywhere: that means the UI consuming them
  // has not been built yet, and reporting every key as unused would bury the checks that
  // matter under hundreds of lines of noise.
  if (usedKeys.size === 0) {
    console.log(`· No translation keys referenced yet — skipping the unused-key report.`)
  } else {
    for (const key of baseKeys) {
      if (usedKeys.has(key)) continue

      const bare = key.slice(key.indexOf(':') + 1)
      const isDynamic = DYNAMIC_KEY_GROUPS.test(bare)

      // A plural variant counts as used when its base key is referenced.
      const withoutPlural = key.replace(PLURAL_SUFFIX, '')
      const isUsedPlural = withoutPlural !== key && usedKeys.has(withoutPlural)

      if (!isDynamic && !isUsedPlural) warnings.push(`unused key "${key}"`)
    }
  }

  for (const warning of warnings) console.warn(`  ! ${warning}`)

  if (errors.length > 0) {
    console.error('\ni18n problems:\n')
    for (const error of errors) console.error(`  ✖ ${error}`)
    console.error(`\n${errors.length} error(s).\n`)
    process.exit(1)
  }

  console.log(
    `✓ i18n consistent — ${baseKeys.size} keys across ${locales.length} locale(s)` +
      (warnings.length > 0 ? `, ${warnings.length} unused` : '') +
      '.',
  )
}

await main()
