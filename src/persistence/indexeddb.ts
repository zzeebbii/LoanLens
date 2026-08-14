import type { Loan } from '@/domain/loan'
import type { Scenario } from '@/domain/scenario'
import type { AppSettings, LoanRepository } from '@/persistence/repository'
import type { StoredLoan, StoredScenario } from '@/persistence/schema'

import Dexie, { type EntityTable } from 'dexie'

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
 * IndexedDB storage, via Dexie.
 *
 * IndexedDB rather than `localStorage`: full schedules with per-row overrides across
 * several loans and scenarios will outgrow a ~5 MB string-only store, and rewriting the
 * whole blob on every keystroke scales badly.
 *
 * Everything is stored in the shape defined by `schema.ts` — money as decimal strings —
 * because `bigint` does not survive structured cloning into an index reliably and does not
 * survive JSON at all.
 */

const DATABASE_NAME = 'loanlens'
const DATABASE_VERSION = 1

/** Settings live in a keyed table so the store shape stays uniform. */
interface StoredSettingsRow {
  readonly key: 'app'
  readonly value: AppSettings
}

class LoanLensDatabase extends Dexie {
  declare loans: EntityTable<StoredLoan, 'id'>
  declare scenarios: EntityTable<StoredScenario, 'id'>
  declare settings: EntityTable<StoredSettingsRow, 'key'>

  constructor(name: string) {
    super(name)
    this.version(DATABASE_VERSION).stores({
      loans: 'id, name',
      // `loanId` is indexed because listing a loan's scenarios is the common read.
      scenarios: 'id, loanId, createdAt',
      settings: 'key',
    })
  }
}

/**
 * Reads a stored record, validating it first.
 *
 * Stored data can predate the current code, or have been written by an import of a
 * hand-edited file. Validating on read means a single corrupt record surfaces as a named
 * error rather than as a schedule quietly computed from a malformed loan.
 */
function decodeLoan(row: StoredLoan): Loan {
  const result = storedLoanSchema.safeParse(row)
  if (!result.success) {
    throw new StorageError(
      `Stored loan "${row.id}" is not valid: ${result.error.issues[0]?.message ?? 'unknown reason'}`,
      { cause: result.error },
    )
  }
  return fromStoredLoan(result.data)
}

function decodeScenario(row: StoredScenario): Scenario {
  const result = storedScenarioSchema.safeParse(row)
  if (!result.success) {
    throw new StorageError(
      `Stored scenario "${row.id}" is not valid: ${result.error.issues[0]?.message ?? 'unknown reason'}`,
      { cause: result.error },
    )
  }
  return fromStoredScenario(result.data)
}

export class IndexedDbLoanRepository implements LoanRepository {
  private readonly database: LoanLensDatabase

  constructor(name: string = DATABASE_NAME) {
    this.database = new LoanLensDatabase(name)
  }

  /**
   * True when IndexedDB is actually usable, not merely defined.
   *
   * Some engines expose `indexedDB` in private browsing and then reject the open, so
   * feature-detecting the global is not enough — the only reliable test is to open it.
   */
  static async isAvailable(): Promise<boolean> {
    if (typeof globalThis.indexedDB === 'undefined') return false
    try {
      const probe = new LoanLensDatabase(`${DATABASE_NAME}-probe`)
      await probe.open()
      probe.close()
      await Dexie.delete(`${DATABASE_NAME}-probe`)
      return true
    } catch {
      return false
    }
  }

  async listLoans(): Promise<Loan[]> {
    const rows = await this.database.loans.toArray()
    return rows.map(decodeLoan)
  }

  async getLoan(id: string): Promise<Loan | null> {
    const row = await this.database.loans.get(id)
    return row === undefined ? null : decodeLoan(row)
  }

  async saveLoan(loan: Loan): Promise<void> {
    await this.database.loans.put(toStoredLoan(loan))
  }

  async deleteLoan(id: string): Promise<void> {
    // One transaction: a loan deleted without its scenarios would leave records that can
    // never be opened again.
    await this.database.transaction(
      'rw',
      this.database.loans,
      this.database.scenarios,
      async () => {
        await this.database.loans.delete(id)
        await this.database.scenarios.where('loanId').equals(id).delete()
      },
    )
  }

  async listScenarios(loanId: string): Promise<Scenario[]> {
    const rows = await this.database.scenarios.where('loanId').equals(loanId).sortBy('createdAt')
    return rows.map(decodeScenario)
  }

  async getScenario(id: string): Promise<Scenario | null> {
    const row = await this.database.scenarios.get(id)
    return row === undefined ? null : decodeScenario(row)
  }

  async saveScenario(scenario: Scenario): Promise<void> {
    await this.database.scenarios.put(toStoredScenario(scenario))
  }

  async deleteScenario(id: string): Promise<void> {
    await this.database.scenarios.delete(id)
  }

  async getSettings(): Promise<AppSettings> {
    const row = await this.database.settings.get('app')
    // Merged over the defaults so a settings record written by an older version, missing
    // a field added since, still loads.
    return row === undefined ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...row.value }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.database.settings.put({ key: 'app', value: settings })
  }

  async clear(): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.loans,
      this.database.scenarios,
      this.database.settings,
      async () => {
        await this.database.loans.clear()
        await this.database.scenarios.clear()
        await this.database.settings.clear()
      },
    )
  }

  close(): void {
    this.database.close()
  }
}
