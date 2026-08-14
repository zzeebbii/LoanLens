import type { DayCountConvention } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { RoundingMode } from '@/domain/money'
import type { Scenario } from '@/domain/scenario'
import type { ForecastAssumption } from '@/rates/forecast'

/**
 * The storage contract.
 *
 * An interface rather than a concrete class because it makes the whole app testable
 * against an in-memory implementation, and because IndexedDB is unavailable in more
 * situations than one expects — private browsing in some engines, storage quota refusals,
 * an embedded webview. Something has to be able to stand in.
 *
 * There is no remote implementation and none is planned: see
 * docs/adr/0003-static-local-first-deployment.md.
 */

export interface AppSettings {
  /** BCP 47 tag. `null` means follow the browser. */
  readonly locale: string | null
  readonly theme: 'light' | 'dark' | 'system'
  /** Defaults applied to a newly created loan, so a user sets them once. */
  readonly defaultDayCount: DayCountConvention
  readonly defaultRounding: RoundingMode
  readonly defaultForecast: ForecastAssumption
  /** Provider id used for new floating-rate loans. */
  readonly defaultRateProviderId: string
}

export interface LoanRepository {
  listLoans(): Promise<Loan[]>
  getLoan(id: string): Promise<Loan | null>
  /** Inserts or replaces by id. */
  saveLoan(loan: Loan): Promise<void>
  /** Also removes the loan's scenarios — an orphaned scenario has nothing to compare to. */
  deleteLoan(id: string): Promise<void>

  listScenarios(loanId: string): Promise<Scenario[]>
  getScenario(id: string): Promise<Scenario | null>
  saveScenario(scenario: Scenario): Promise<void>
  deleteScenario(id: string): Promise<void>

  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>

  /** Removes everything. Used by import-replace and by "delete all my data". */
  clear(): Promise<void>
}

export const DEFAULT_SETTINGS: AppSettings = {
  locale: null,
  theme: 'system',
  // MONTHLY_NOMINAL because it is what a user comparing against a public calculator
  // expects. Many Nordic lenders use ACT/360; that is a per-loan setting to correct.
  defaultDayCount: 'MONTHLY_NOMINAL',
  defaultRounding: 'HALF_UP',
  defaultForecast: { kind: 'HOLD_LAST' },
  defaultRateProviderId: 'ecb',
}

/** Thrown when storage is unavailable or refuses a write. */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
  }
}
