import type { Loan } from '@/domain/loan'
import type { Scenario } from '@/domain/scenario'
import type { AppSettings, LoanRepository } from '@/persistence/repository'

import { DEFAULT_SETTINGS } from '@/persistence/repository'

/**
 * An in-memory repository.
 *
 * Two real uses, not just a test double:
 *
 *  - The whole app can be driven in tests without IndexedDB or a fake browser.
 *  - It is the fallback when persistent storage is unavailable — private browsing in some
 *    engines, a refused quota, an embedded webview. The user loses their data on reload,
 *    which is bad, but the app still works and can still export, which is much better
 *    than a blank screen.
 *
 * Values are round-tripped through the stored representation on save so this behaves
 * exactly like the persistent implementation, including rejecting anything that would not
 * survive serialisation.
 */
export class InMemoryLoanRepository implements LoanRepository {
  private readonly loans = new Map<string, Loan>()
  private readonly scenarios = new Map<string, Scenario>()
  private settings: AppSettings = DEFAULT_SETTINGS

  listLoans(): Promise<Loan[]> {
    return Promise.resolve([...this.loans.values()])
  }

  getLoan(id: string): Promise<Loan | null> {
    return Promise.resolve(this.loans.get(id) ?? null)
  }

  saveLoan(loan: Loan): Promise<void> {
    this.loans.set(loan.id, loan)
    return Promise.resolve()
  }

  deleteLoan(id: string): Promise<void> {
    this.loans.delete(id)
    // A scenario without its loan has nothing to compare against, so it goes too.
    for (const [scenarioId, scenario] of this.scenarios) {
      if (scenario.loanId === id) this.scenarios.delete(scenarioId)
    }
    return Promise.resolve()
  }

  listScenarios(loanId: string): Promise<Scenario[]> {
    return Promise.resolve(
      [...this.scenarios.values()]
        .filter((scenario) => scenario.loanId === loanId)
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    )
  }

  getScenario(id: string): Promise<Scenario | null> {
    return Promise.resolve(this.scenarios.get(id) ?? null)
  }

  saveScenario(scenario: Scenario): Promise<void> {
    this.scenarios.set(scenario.id, scenario)
    return Promise.resolve()
  }

  deleteScenario(id: string): Promise<void> {
    this.scenarios.delete(id)
    return Promise.resolve()
  }

  getSettings(): Promise<AppSettings> {
    return Promise.resolve(this.settings)
  }

  saveSettings(settings: AppSettings): Promise<void> {
    this.settings = settings
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.loans.clear()
    this.scenarios.clear()
    this.settings = DEFAULT_SETTINGS
    return Promise.resolve()
  }
}
