#!/usr/bin/env node
/**
 * Refreshes the bundled EURIBOR snapshot from the ECB Data Portal.
 *
 * Run by `.github/workflows/refresh-rates.yml` on a schedule, and by hand when needed.
 * The file it writes is what gives the app a fast first paint, an offline mode, and a
 * fallback if the ECB is ever unreachable — see `src/rates/providers/snapshot.ts`.
 *
 *   node scripts/refresh-rates.mjs [--out public/data/euribor.json]
 *
 * Writes nothing if any tenor fails to fetch. A snapshot missing a series would
 * half-work, which is worse than an unchanged one: the app would fall back to the ECB
 * for some loans and silently disagree between sources.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BASE_URL = 'https://data-api.ecb.europa.eu/service/data/FM'

/**
 * Mirrors SERIES_KEYS in src/rates/providers/ecb.ts. Duplicated deliberately: this
 * script runs in CI without a build step, and importing TypeScript here would mean
 * compiling the app just to fetch a file.
 *
 * Note 12M is `EURIBOR1YD_`, not `EURIBOR12MD_` — the wrong key returns an empty series
 * rather than an error.
 */
const SERIES_KEYS = {
  '1M': 'M.U2.EUR.RT.MM.EURIBOR1MD_.HSTA',
  '3M': 'M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA',
  '6M': 'M.U2.EUR.RT.MM.EURIBOR6MD_.HSTA',
  '12M': 'M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA',
}

const EARLIEST_PERIOD = '1999-01'
const SCHEMA_VERSION = 1

/** Splits one CSV record, honouring quoted fields. The TITLE columns contain commas. */
function splitCsvRecord(line) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        current += character
      }
    } else if (character === '"') {
      inQuotes = true
    } else if (character === ',') {
      fields.push(current)
      current = ''
    } else {
      current += character
    }
  }

  fields.push(current)
  return fields
}

/** Locates columns by header name, never by position. */
function parseCsv(csv) {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const header = lines[0]
  if (header === undefined) throw new Error('Empty response')

  const columns = splitCsvRecord(header)
  const periodIndex = columns.indexOf('TIME_PERIOD')
  const valueIndex = columns.indexOf('OBS_VALUE')

  if (periodIndex === -1 || valueIndex === -1) {
    throw new Error('Response is missing TIME_PERIOD or OBS_VALUE')
  }

  const observations = []

  for (const line of lines.slice(1)) {
    const fields = splitCsvRecord(line)
    const period = fields[periodIndex]?.trim()
    const raw = fields[valueIndex]?.trim()

    if (!period || !raw) continue
    if (!/^\d{4}-\d{2}$/.test(period)) continue

    const ratePercent = Number(raw)
    if (!Number.isFinite(ratePercent)) continue

    observations.push({ period, ratePercent })
  }

  observations.sort((a, b) => a.period.localeCompare(b.period))
  return observations
}

async function fetchTenor(tenor) {
  const url = new URL(`${BASE_URL}/${SERIES_KEYS[tenor]}`)
  url.searchParams.set('format', 'csvdata')
  url.searchParams.set('startPeriod', EARLIEST_PERIOD)

  const response = await fetch(url, { headers: { Accept: 'text/csv' } })
  if (!response.ok) {
    throw new Error(`${tenor}: ECB returned ${response.status} ${response.statusText}`)
  }

  const observations = parseCsv(await response.text())
  if (observations.length === 0) {
    throw new Error(`${tenor}: no observations returned — the series key may have changed`)
  }

  return observations
}

function parseArguments(argv) {
  const outIndex = argv.indexOf('--out')
  const out =
    outIndex === -1 ? path.join('public', 'data', 'euribor.json') : (argv[outIndex + 1] ?? '')
  if (!out) throw new Error('--out requires a path')
  return { out: path.resolve(ROOT, out) }
}

async function main() {
  const { out } = parseArguments(process.argv.slice(2))

  const series = {}
  for (const tenor of Object.keys(SERIES_KEYS)) {
    const observations = await fetchTenor(tenor)
    series[tenor] = observations
    console.log(
      `  ${tenor.padEnd(3)} ${String(observations.length).padStart(4)} observations, ` +
        `${observations[0].period} to ${observations.at(-1).period}, ` +
        `latest ${observations.at(-1).ratePercent.toFixed(4)}%`,
    )
  }

  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    source: 'ECB Data Portal (data.ecb.europa.eu), EURIBOR provided by Refinitiv',
    retrievedAt: new Date().toISOString(),
    series,
  }

  // Compare on the data alone: `retrievedAt` changes on every run, so including it would
  // produce a commit a month even when no new fixing has been published.
  const serialised = JSON.stringify(snapshot, null, 2)
  let previousSeries = null
  try {
    previousSeries = JSON.stringify(JSON.parse(await readFile(out, 'utf8')).series)
  } catch {
    // No existing snapshot, or an unreadable one. Either way, write.
  }

  if (previousSeries === JSON.stringify(series)) {
    console.log('\n· No new observations — leaving the snapshot unchanged.')
    return
  }

  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, `${serialised}\n`, 'utf8')
  console.log(`\n✓ Wrote ${path.relative(ROOT, out)}`)
}

await main()
