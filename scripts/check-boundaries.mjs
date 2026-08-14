#!/usr/bin/env node
/**
 * Module boundary guard.
 *
 * The whole architecture rests on one rule: the financial engine is pure and
 * knows nothing about React, the DOM, or the UI. Conventions rot; this script
 * fails the build instead.
 *
 * Each layer declares exactly what it is allowed to import. Anything not on the
 * list is an error, so adding a dependency to a pure layer is a deliberate act
 * that shows up in review rather than something that drifts in.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

/**
 * @typedef {object} LayerRule
 * @property {string}   dir        Directory under src/, e.g. "domain".
 * @property {string}   rationale  Shown in the failure message.
 * @property {string[]} layers     Sibling src/ layers this layer may import from.
 * @property {string[]} packages   npm packages this layer may import.
 */

/** @type {LayerRule[]} */
const RULES = [
  {
    dir: 'domain',
    rationale:
      'domain/ is the financial engine: pure TypeScript, no dependencies, runnable outside a browser.',
    layers: ['domain'],
    packages: [],
  },
  {
    dir: 'rates',
    rationale:
      'rates/ is the pluggable rate-provider abstraction. It may model money and dates, but must not know about storage or UI.',
    layers: ['rates', 'domain'],
    packages: ['zod'],
  },
  {
    dir: 'persistence',
    rationale:
      'persistence/ stores domain objects. It must not reach upward into React or feature code.',
    layers: ['persistence', 'domain', 'rates'],
    packages: ['dexie', 'zod'],
  },
]

/** Bare specifiers that are never acceptable in a pure layer, listed for a better error. */
const ALWAYS_FORBIDDEN = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react-i18next',
  'i18next',
  'recharts',
  'clsx',
  'tailwind-merge',
])

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** @returns {Promise<string[]>} absolute paths of .ts/.tsx files under `dir` */
async function collectSourceFiles(dir) {
  /** @type {string[]} */
  const found = []

  /** @param {string} current */
  async function walk(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return // Layer does not exist yet; nothing to check.
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full)
      }
    }
  }

  await walk(dir)
  return found
}

/** @returns {string[]} every module specifier imported by `source` */
function extractSpecifiers(source) {
  /** @type {string[]} */
  const specifiers = []
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}

/**
 * Resolves a specifier to the src/ layer it belongs to, or null if it is a
 * bare package specifier.
 *
 * @param {string} specifier
 * @param {string} fromFile absolute path of the importing file
 * @returns {string | null}
 */
function resolveLayer(specifier, fromFile) {
  let relativeToSrc

  if (specifier.startsWith('@/')) {
    relativeToSrc = specifier.slice('@/'.length)
  } else if (specifier.startsWith('.')) {
    const absolute = path.resolve(path.dirname(fromFile), specifier)
    relativeToSrc = path.relative(SRC, absolute)
    // A relative import that climbs out of src/ entirely.
    if (relativeToSrc.startsWith('..')) return '<outside-src>'
  } else {
    return null
  }

  const [layer] = relativeToSrc.split(path.sep === '\\' ? /[\\/]/ : '/')
  return layer ?? '<unknown>'
}

/** Node builtins are permitted nowhere in these layers, but name them clearly if used. */
function isNodeBuiltin(specifier) {
  return specifier.startsWith('node:')
}

async function main() {
  /** @type {string[]} */
  const violations = []

  for (const rule of RULES) {
    const layerDir = path.join(SRC, rule.dir)
    const files = await collectSourceFiles(layerDir)

    for (const file of files) {
      const relative = path.relative(ROOT, file)
      const source = await readFile(file, 'utf8')

      for (const specifier of extractSpecifiers(source)) {
        const layer = resolveLayer(specifier, file)

        if (layer === null) {
          // Bare package specifier.
          const packageName = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : (specifier.split('/')[0] ?? specifier)

          if (isNodeBuiltin(specifier)) {
            violations.push(
              `${relative}: imports Node builtin "${specifier}". ${rule.dir}/ must run in the browser too.`,
            )
          } else if (ALWAYS_FORBIDDEN.has(specifier) || ALWAYS_FORBIDDEN.has(packageName)) {
            violations.push(`${relative}: imports "${specifier}". ${rule.rationale}`)
          } else if (!rule.packages.includes(packageName)) {
            violations.push(
              `${relative}: imports package "${specifier}", which is not in the allowlist for ${rule.dir}/ [${rule.packages.join(', ') || 'none'}]. ${rule.rationale}`,
            )
          }
          continue
        }

        if (!rule.layers.includes(layer)) {
          violations.push(
            `${relative}: imports "${specifier}" from layer "${layer}". ${rule.dir}/ may only import from [${rule.layers.join(', ')}]. ${rule.rationale}`,
          )
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('\nModule boundary violations:\n')
    for (const violation of violations) console.error(`  ✖ ${violation}`)
    console.error(
      `\n${violations.length} violation(s). See docs/architecture.md for why these boundaries exist.\n`,
    )
    process.exit(1)
  }

  console.log('✓ Module boundaries intact.')
}

await main()
