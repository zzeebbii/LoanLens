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

/**
 * Keys that are assembled at runtime and therefore cannot be found by a static
 * scan. Prefixes listed here are exempt from the "unused key" warning.
 */
const DYNAMIC_KEY_PREFIXES = [
  'domain.amortization.',
  'domain.dayCount.',
  'domain.tenor.',
  'rates.provider.',
  'errors.',
]

/** Matches t('key'), t("key"), i18nKey="key" and tKey: 'key'. */
const KEY_USAGE_RE =
  /\bt\(\s*['"]([\w.:-]+)['"]|i18nKey\s*=\s*['"]([\w.:-]+)['"]|\btKey\s*:\s*['"]([\w.:-]+)['"]/g

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

/**
 * Normalises a used key to `namespace:key` form. Keys written without an
 * explicit namespace belong to the default namespace, `common`.
 */
function normaliseKey(key) {
  return key.includes(':') ? key : `common:${key}`
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
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(KEY_USAGE_RE)) {
      const key = match[1] ?? match[2] ?? match[3]
      if (!key) continue
      const normalised = normaliseKey(key)
      usedKeys.add(normalised)
      if (!baseKeys.has(normalised)) {
        errors.push(
          `${path.relative(ROOT, file)}: uses key "${normalised}" not defined in ${BASE_LOCALE}`,
        )
      }
    }
  }

  // 3. Unused base keys are a warning, not a failure.
  for (const key of baseKeys) {
    const bare = key.slice(key.indexOf(':') + 1)
    const isDynamic = DYNAMIC_KEY_PREFIXES.some((prefix) => bare.startsWith(prefix))
    if (!usedKeys.has(key) && !isDynamic) warnings.push(`unused key "${key}"`)
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
