import type { Scenario } from '@/domain/scenario'

import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { fromMajorUnits } from '@/domain/money'
import { fixedRateLoan, floatingRateLoan } from '@/domain/testing/fixtures'
import { InMemoryLoanRepository } from '@/persistence/memory'
import { DEFAULT_SETTINGS } from '@/persistence/repository'

function scenarioFor(loanId: string, id: string, createdAt: string): Scenario {
  return {
    id,
    loanId,
    name: id,
    events: [
      {
        kind: 'EXTRA_PAYMENT',
        period: yearMonth(2026, 12),
        amount: fromMajorUnits(1000),
        effect: 'SHORTEN_TERM',
      },
    ],
    createdAt,
  }
}

describe('InMemoryLoanRepository', () => {
  it('saves and reads a loan', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveLoan(floatingRateLoan())

    expect(await repository.getLoan('fixture-floating')).toEqual(floatingRateLoan())
    expect(await repository.listLoans()).toHaveLength(1)
  })

  it('returns null for a loan it does not have', async () => {
    expect(await new InMemoryLoanRepository().getLoan('nope')).toBeNull()
  })

  it('replaces by id rather than duplicating', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveLoan(fixedRateLoan())
    await repository.saveLoan(fixedRateLoan({ principal: fromMajorUnits(1) }))

    expect(await repository.listLoans()).toHaveLength(1)
    expect((await repository.getLoan('fixture-fixed'))!.principal).toBe(fromMajorUnits(1))
  })

  it('deletes a loan together with its scenarios', async () => {
    // An orphaned scenario has nothing to compare against and can never be opened again.
    const repository = new InMemoryLoanRepository()
    await repository.saveLoan(fixedRateLoan())
    await repository.saveLoan(floatingRateLoan())
    await repository.saveScenario(scenarioFor('fixture-fixed', 'a', '2026-01-01T00:00:00.000Z'))
    await repository.saveScenario(scenarioFor('fixture-floating', 'b', '2026-01-01T00:00:00.000Z'))

    await repository.deleteLoan('fixture-fixed')

    expect(await repository.getScenario('a')).toBeNull()
    // The other loan's scenario is untouched.
    expect(await repository.getScenario('b')).not.toBeNull()
  })

  it('lists a loan’s scenarios oldest first', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveScenario(scenarioFor('L', 'newer', '2026-06-01T00:00:00.000Z'))
    await repository.saveScenario(scenarioFor('L', 'older', '2026-01-01T00:00:00.000Z'))

    expect((await repository.listScenarios('L')).map((entry) => entry.id)).toEqual([
      'older',
      'newer',
    ])
  })

  it('scopes scenarios to their loan', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveScenario(scenarioFor('A', 'a1', '2026-01-01T00:00:00.000Z'))
    await repository.saveScenario(scenarioFor('B', 'b1', '2026-01-01T00:00:00.000Z'))

    expect(await repository.listScenarios('A')).toHaveLength(1)
    expect(await repository.listScenarios('C')).toEqual([])
  })

  it('deletes a scenario without touching its loan', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveLoan(fixedRateLoan())
    await repository.saveScenario(scenarioFor('fixture-fixed', 'a', '2026-01-01T00:00:00.000Z'))

    await repository.deleteScenario('a')

    expect(await repository.getScenario('a')).toBeNull()
    expect(await repository.getLoan('fixture-fixed')).not.toBeNull()
  })

  it('starts from the documented defaults', async () => {
    expect(await new InMemoryLoanRepository().getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('saves settings', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark', locale: 'fi-FI' })

    const settings = await repository.getSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.locale).toBe('fi-FI')
  })

  it('clear removes everything and resets settings', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveLoan(fixedRateLoan())
    await repository.saveScenario(scenarioFor('fixture-fixed', 'a', '2026-01-01T00:00:00.000Z'))
    await repository.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })

    await repository.clear()

    expect(await repository.listLoans()).toEqual([])
    expect(await repository.getScenario('a')).toBeNull()
    expect(await repository.getSettings()).toEqual(DEFAULT_SETTINGS)
  })
})
