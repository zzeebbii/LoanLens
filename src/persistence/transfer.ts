import type { Loan } from '@/domain/loan'
import type { Scenario } from '@/domain/scenario'
import type { AppSettings, LoanRepository } from '@/persistence/repository'
import type { StoredLoan, StoredScenario } from '@/persistence/schema'

import { z } from 'zod'

import { parseYearMonth } from '@/domain/dates'
import { DEFAULT_SETTINGS, StorageError } from '@/persistence/repository'
import {
  fromStoredLoan,
  fromStoredScenario,
  storedLoanSchema,
  storedScenarioSchema,
  toStoredLoan,
  toStoredScenario,
} from '@/persistence/schema'

/**
 * Export and import.
 *
 * With no backend and no sync (ADR 0003), this file *is* the user's backup and the only
 * way their data moves between devices. Two consequences follow:
 *
 *  - It has to be versioned from the first release. Users accumulate data, and a migration
 *    path added later is a migration path added too late.
 *  - It has to be readable. Someone recovering data from a file they exported three years
 *    ago should be able to open it in a text editor and understand it.
 */

export const EXPORT_SCHEMA_VERSION = 1

const settingsSchema = z.object({
  locale: z.string().nullable(),
  theme: z.enum(['light', 'dark', 'system']),
  defaultDayCount: z.enum([
    'MONTHLY_NOMINAL',
    'ACT_360',
    'ACT_365',
    'THIRTY_360_EU',
    'THIRTY_360_US',
  ]),
  defaultRounding: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']),
  defaultForecast: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('HOLD_LAST') }),
    z.object({ kind: z.literal('SHOCK'), deltaBps: z.number().finite() }),
    z.object({ kind: z.literal('FIXED'), rate: z.number().finite() }),
    z.object({
      kind: z.literal('CURVE'),
      points: z.array(z.object({ period: z.string(), rate: z.number().finite() })),
    }),
  ]),
  defaultRateProviderId: z.string().min(1),
})

export const exportFileSchema = z.object({
  /** Identifies the file for a human and guards against importing something unrelated. */
  application: z.literal('LoanLens'),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string().min(1),
  loans: z.array(storedLoanSchema),
  scenarios: z.array(storedScenarioSchema),
  /** Optional: a file exported before settings existed, or exported deliberately without. */
  settings: settingsSchema.optional(),
})

/**
 * The file this version writes.
 *
 * Declared rather than inferred from the schema, and the two differ on purpose. The schema
 * describes what is *accepted* — plain strings, mutable arrays, anything a hand-edited or
 * older file might contain. This describes what is *produced*, and reuses `AppSettings` so
 * a field added to settings cannot be silently dropped from an export.
 */
export interface ExportFile {
  readonly application: 'LoanLens'
  readonly schemaVersion: number
  readonly exportedAt: string
  readonly loans: readonly StoredLoan[]
  readonly scenarios: readonly StoredScenario[]
  readonly settings: AppSettings
}

/**
 * Maps validated settings onto `AppSettings`.
 *
 * The schema cannot produce the branded `YearMonth` a forecast curve needs, so the periods
 * are re-parsed here. Anything unparseable is dropped rather than defaulted: a curve point
 * with a broken period is better absent than silently anchored to the wrong month.
 */
function toAppSettings(parsed: z.infer<typeof settingsSchema> | undefined): AppSettings {
  if (parsed === undefined) return DEFAULT_SETTINGS

  const forecast: AppSettings['defaultForecast'] =
    parsed.defaultForecast.kind === 'CURVE'
      ? {
          kind: 'CURVE',
          points: parsed.defaultForecast.points.flatMap((point) => {
            const period = parseYearMonth(point.period)
            return period === null ? [] : [{ period, rate: point.rate }]
          }),
        }
      : parsed.defaultForecast

  return { ...parsed, defaultForecast: forecast }
}

export interface ExportBundle {
  readonly loans: readonly Loan[]
  readonly scenarios: readonly Scenario[]
  readonly settings: AppSettings
}

/** Thrown when an import file cannot be read. Carries a message worth showing the user. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ImportError'
  }
}

/** Builds the export file contents. `now` is injected so tests stay deterministic. */
export function buildExport(bundle: ExportBundle, now: () => Date = () => new Date()): ExportFile {
  return {
    application: 'LoanLens',
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now().toISOString(),
    loans: bundle.loans.map(toStoredLoan),
    scenarios: bundle.scenarios.map(toStoredScenario),
    settings: bundle.settings,
  }
}

/**
 * Serialises to JSON.
 *
 * Indented deliberately. The file is a user's only backup; being able to read and, at a
 * pinch, hand-repair it is worth more than the bytes saved.
 */
export function serialiseExport(file: ExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** A filename that sorts chronologically and says what it is. */
export function exportFilename(now: () => Date = () => new Date()): string {
  const stamp = now().toISOString().slice(0, 10)
  return `loanlens-backup-${stamp}.json`
}

/**
 * Parses and validates an import file.
 *
 * Reports every problem it found rather than only the first, because a user handed a file
 * that will not import needs to know whether it is one bad record or a wrong file
 * entirely.
 */
export function parseImport(raw: unknown): ExportBundle {
  const result = exportFileSchema.safeParse(raw)

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
    throw new ImportError(
      'This file is not a LoanLens backup, or it has been damaged.',
      issues.slice(0, 10),
      { cause: result.error },
    )
  }

  const file = result.data

  if (file.schemaVersion > EXPORT_SCHEMA_VERSION) {
    // Refuse rather than guess. A file from a newer version may contain fields this build
    // would drop, and a silent partial import loses data the user believes is safe.
    throw new ImportError(
      `This backup was written by a newer version of LoanLens (format ${file.schemaVersion}, ` +
        `this version reads ${EXPORT_SCHEMA_VERSION}). Update the app and try again.`,
    )
  }

  const scenarioIssues: string[] = []
  const loanIds = new Set(file.loans.map((loan) => loan.id))

  for (const scenario of file.scenarios) {
    if (!loanIds.has(scenario.loanId)) {
      scenarioIssues.push(
        `scenario "${scenario.name}" refers to loan "${scenario.loanId}", which is not in this file`,
      )
    }
  }

  if (scenarioIssues.length > 0) {
    throw new ImportError('This backup is internally inconsistent.', scenarioIssues.slice(0, 10))
  }

  return {
    loans: file.loans.map(fromStoredLoan),
    scenarios: file.scenarios.map(fromStoredScenario),
    settings: toAppSettings(file.settings),
  }
}

/** Parses a JSON string, distinguishing malformed JSON from a valid-JSON wrong shape. */
export function parseImportJson(text: string): ExportBundle {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    throw new ImportError('This file is not valid JSON.', [], { cause })
  }
  return parseImport(raw)
}

export type ImportMode = 'REPLACE' | 'MERGE'

export interface ImportResult {
  readonly loansImported: number
  readonly scenariosImported: number
  readonly mode: ImportMode
}

/**
 * Writes an imported bundle into a repository.
 *
 * `REPLACE` wipes first — the "restore my backup" case. `MERGE` adds to what is there,
 * overwriting by id, which is how a user brings one device's loans onto another. Merge is
 * the safer default for a UI to offer; replace should require a deliberate confirmation,
 * since it destroys data the file may not contain.
 */
export async function applyImport(
  repository: LoanRepository,
  bundle: ExportBundle,
  mode: ImportMode,
): Promise<ImportResult> {
  try {
    if (mode === 'REPLACE') {
      await repository.clear()
    }

    // Loans first, so a scenario is never briefly present without the loan it belongs to.
    // Within each group the writes are independent, so they go together.
    await Promise.all(bundle.loans.map((loan) => repository.saveLoan(loan)))
    await Promise.all(bundle.scenarios.map((scenario) => repository.saveScenario(scenario)))
    await repository.saveSettings(bundle.settings)

    return {
      loansImported: bundle.loans.length,
      scenariosImported: bundle.scenarios.length,
      mode,
    }
  } catch (cause) {
    throw new StorageError('Could not write the imported data to storage.', { cause })
  }
}

/** Reads everything out of a repository, ready to export. */
export async function collectExport(repository: LoanRepository): Promise<ExportBundle> {
  const loans = await repository.listLoans()
  const scenarios = (
    await Promise.all(loans.map((loan) => repository.listScenarios(loan.id)))
  ).flat()

  return { loans, scenarios, settings: await repository.getSettings() }
}
