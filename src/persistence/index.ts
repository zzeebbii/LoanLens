import type { LoanRepository } from '@/persistence/repository'

import { IndexedDbLoanRepository } from '@/persistence/indexeddb'
import { InMemoryLoanRepository } from '@/persistence/memory'

export type { AppSettings, LoanRepository } from '@/persistence/repository'
export { DEFAULT_SETTINGS, StorageError } from '@/persistence/repository'

export { InMemoryLoanRepository } from '@/persistence/memory'
export { IndexedDbLoanRepository } from '@/persistence/indexeddb'

export type { ExportBundle, ExportFile, ImportMode, ImportResult } from '@/persistence/transfer'
export {
  applyImport,
  buildExport,
  collectExport,
  EXPORT_SCHEMA_VERSION,
  exportFilename,
  exportFileSchema,
  ImportError,
  parseImport,
  parseImportJson,
  serialiseExport,
} from '@/persistence/transfer'

export type { StoredLoan, StoredScenario } from '@/persistence/schema'
export {
  fromStoredLoan,
  fromStoredScenario,
  storedLoanSchema,
  storedScenarioSchema,
  toStoredLoan,
  toStoredScenario,
} from '@/persistence/schema'

export interface RepositoryResolution {
  readonly repository: LoanRepository
  /**
   * True when the repository does not survive a reload. The UI must say so plainly and
   * push the user toward exporting, rather than letting them enter a loan and lose it.
   */
  readonly ephemeral: boolean
}

/**
 * Picks the best available repository.
 *
 * Persistent storage is not always usable — private browsing in some engines, a refused
 * quota, an embedded webview. Falling back to memory keeps the app working and keeps
 * export available, which is far better than a blank screen; the caller is told so it can
 * warn the user.
 */
export async function resolveRepository(): Promise<RepositoryResolution> {
  if (await IndexedDbLoanRepository.isAvailable()) {
    return { repository: new IndexedDbLoanRepository(), ephemeral: false }
  }
  return { repository: new InMemoryLoanRepository(), ephemeral: true }
}
