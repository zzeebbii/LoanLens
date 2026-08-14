#!/usr/bin/env node
/**
 * Validates the committed EURIBOR snapshot.
 *
 * The snapshot is written by an unattended scheduled job, and it is the app's offline
 * and fallback data source. A truncated or reordered file would not fail the build on its
 * own — it would surface much later as a schedule computed from half a series.
 *
 * This is a deliberately independent check, not a re-run of the runtime schema in
 * `src/rates/providers/snapshot.ts`. That schema guards what the *browser* loads; this
 * guards what gets *committed*, and it checks things a schema cannot express: ordering,
 * gaps, and whether the data reaches far enough back and forward to be useful. Two
 * different checks on unattended output is the point.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT_PATH = path.join(ROOT, 'public', 'data', 'euribor.json')

const EXPECTED_TENORS = ['1M', '3M', '6M', '12M']
const EARLIEST_EXPECTED = '1999-01'
/** EURIBOR has ranged from about -0.6% to 5.4% since 1999. Wider bounds catch unit errors. */
const RATE_BOUNDS = { min: -5, max: 25 }
/** Months behind the current month before the snapshot is called stale. */
const STALENESS_MONTHS = 4

const errors = []
const warnings = []

function monthsBetween(from, to) {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}

function currentPeriod() {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function checkSeries(tenor, observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    errors.push(`${tenor}: series is empty`)
    return
  }

  let previousPeriod = null

  for (const [index, observation] of observations.entries()) {
    const where = `${tenor}[${index}]`

    if (typeof observation?.period !== 'string' || !/^\d{4}-\d{2}$/.test(observation.period)) {
      errors.push(`${where}: period ${JSON.stringify(observation?.period)} is not YYYY-MM`)
      continue
    }

    const month = Number(observation.period.slice(5))
    if (month < 1 || month > 12) {
      errors.push(`${where}: month ${month} is out of range`)
    }

    if (typeof observation.ratePercent !== 'number' || !Number.isFinite(observation.ratePercent)) {
      errors.push(
        `${where}: ratePercent ${JSON.stringify(observation.ratePercent)} is not a number`,
      )
    } else if (
      observation.ratePercent < RATE_BOUNDS.min ||
      observation.ratePercent > RATE_BOUNDS.max
    ) {
      errors.push(
        `${where}: ratePercent ${observation.ratePercent} is outside ${RATE_BOUNDS.min}..${RATE_BOUNDS.max}. ` +
          'A fraction written where a percentage belongs looks exactly like this.',
      )
    }

    if (previousPeriod !== null) {
      if (observation.period <= previousPeriod) {
        // Order is load-bearing: `rateAt` walks the series and stops at the first period
        // past the one it wants.
        errors.push(`${where}: period ${observation.period} does not follow ${previousPeriod}`)
      } else {
        const gap = monthsBetween(previousPeriod, observation.period)
        if (gap > 1) {
          warnings.push(
            `${tenor}: ${gap - 1} month(s) missing between ${previousPeriod} and ${observation.period}`,
          )
        }
      }
    }

    previousPeriod = observation.period
  }

  const first = observations[0]?.period
  const last = observations.at(-1)?.period

  if (first !== undefined && first > EARLIEST_EXPECTED) {
    warnings.push(`${tenor}: starts at ${first}, later than the expected ${EARLIEST_EXPECTED}`)
  }

  if (last !== undefined) {
    const behind = monthsBetween(last, currentPeriod())
    if (behind > STALENESS_MONTHS) {
      warnings.push(
        `${tenor}: latest observation is ${last}, ${behind} months behind. ` +
          'Run `node scripts/refresh-rates.mjs`.',
      )
    }
  }
}

async function main() {
  let raw
  try {
    raw = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'))
  } catch (cause) {
    console.error(
      `✖ Could not read ${path.relative(ROOT, SNAPSHOT_PATH)}: ${cause.message}\n` +
        '  Generate it with `node scripts/refresh-rates.mjs`.',
    )
    process.exit(1)
  }

  if (raw.schemaVersion !== 1) {
    errors.push(`schemaVersion is ${JSON.stringify(raw.schemaVersion)}, expected 1`)
  }
  if (typeof raw.source !== 'string' || raw.source.length === 0) {
    errors.push('source is missing — the snapshot must say where the data came from')
  }
  if (typeof raw.retrievedAt !== 'string' || Number.isNaN(Date.parse(raw.retrievedAt))) {
    errors.push('retrievedAt is not a valid ISO 8601 instant')
  }

  const series = raw.series ?? {}

  for (const tenor of EXPECTED_TENORS) {
    if (series[tenor] === undefined) {
      errors.push(`${tenor}: series is absent. A partial refresh is worse than a stale one.`)
    } else {
      checkSeries(tenor, series[tenor])
    }
  }

  for (const tenor of Object.keys(series)) {
    if (!EXPECTED_TENORS.includes(tenor)) {
      errors.push(`${tenor}: unexpected tenor, not one of ${EXPECTED_TENORS.join(', ')}`)
    }
  }

  for (const warning of warnings) console.warn(`  ! ${warning}`)

  if (errors.length > 0) {
    console.error('\nRate snapshot problems:\n')
    for (const error of errors.slice(0, 25)) console.error(`  ✖ ${error}`)
    if (errors.length > 25) console.error(`  … and ${errors.length - 25} more`)
    console.error(`\n${errors.length} error(s).\n`)
    process.exit(1)
  }

  const total = EXPECTED_TENORS.reduce((count, tenor) => count + (series[tenor]?.length ?? 0), 0)
  const latest = series['12M']?.at(-1)
  console.log(
    `✓ Rate snapshot valid — ${total} observations across ${EXPECTED_TENORS.length} tenors, ` +
      `12M latest ${latest?.period} at ${latest?.ratePercent}%.`,
  )
}

await main()
