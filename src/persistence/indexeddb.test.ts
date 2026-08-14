import type { Scenario } from '@/domain/scenario'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { fromMajorUnits, toCents } from '@/domain/money'
import { fixedRateLoan, floatingRateLoan } from '@/domain/testing/fixtures'
import { IndexedDbLoanRepository } from '@/persistence/indexeddb'
import { DEFAULT_SETTINGS, StorageError } from '@/persistence/repository'

/**
 * Exercises the real storage path against `fake-indexeddb`.
 *
 * Worth doing rather than trusting the in-memory implementation as a proxy: this is the
 * code every user's data actually goes through, and it does things the memory version does
 * not — index lookups, transactions, structured cloning, and validating what comes back
 * out. Bugs here lose people's data.
 */

let repository: IndexedDbLoanRepository
let databaseName: string
let counter = 0

function scenarioFor(loanId: string, id: string, createdAt: string): Scenario {
  return {
    id,
    loanId,
    name: id,
    events: [
      {
        kind: 'RECURRING_EXTRA',
        from: yearMonth(2026, 9),
        until: null,
        amount: fromMajorUnits(200),
        effect: 'SHORTEN_TERM',
      },
    ],
    createdAt,
  }
}

beforeEach(() => {
  // A fresh database per test: leaked state between storage tests is maddening to debug.
  counter += 1
  databaseName = `loanlens-test-${counter}`
  repository = new IndexedDbLoanRepository(databaseName)
})

afterEach(() => {
  repository.close()
})

describe('IndexedDbLoanRepository', () => {
  it('reports itself available when IndexedDB works', async () => {
    expect(await IndexedDbLoanRepository.isAvailable()).toBe(true)
  })

  it('saves and reads a loan through a real store', async () => {
    await repository.saveLoan(floatingRateLoan())

    expect(await repository.getLoan('fixture-floating')).toEqual(floatingRateLoan())
    expect(await repository.listLoans()).toHaveLength(1)
  })

  it('keeps money exact across the storage boundary', async () => {
    // bigint does not survive structured cloning into an index reliably and does not
    // survive JSON at all, which is why money is stored as decimal minor units.
    await repository.saveLoan(fixedRateLoan({ principal: fromMajorUnits(123_456.78) }))

    const loaded = await repository.getLoan('fixture-fixed')
    expect(toCents(loaded!.principal)).toBe(12_345_678n)
  })

  it('persists across a fresh repository over the same database', async () => {
    await repository.saveLoan(fixedRateLoan())
    repository.close()

    const reopened = new IndexedDbLoanRepository(databaseName)
    expect(await reopened.getLoan('fixture-fixed')).toEqual(fixedRateLoan())
    reopened.close()
  })

  it('returns null for a loan it does not have', async () => {
    expect(await repository.getLoan('nope')).toBeNull()
  })

  it('replaces by id rather than duplicating', async () => {
    await repository.saveLoan(fixedRateLoan())
    await repository.saveLoan(fixedRateLoan({ name: 'Renamed' }))

    expect(await repository.listLoans()).toHaveLength(1)
    expect((await repository.getLoan('fixture-fixed'))!.name).toBe('Renamed')
  })

  it('deletes a loan and its scenarios in one transaction', async () => {
    await repository.saveLoan(fixedRateLoan())
    await repository.saveLoan(floatingRateLoan())
    await repository.saveScenario(scenarioFor('fixture-fixed', 'a', '2026-01-01T00:00:00.000Z'))
    await repository.saveScenario(scenarioFor('fixture-floating', 'b', '2026-01-01T00:00:00.000Z'))

    await repository.deleteLoan('fixture-fixed')

    expect(await repository.getLoan('fixture-fixed')).toBeNull()
    expect(await repository.getScenario('a')).toBeNull()
    // The other loan and its scenario are untouched.
    expect(await repository.getLoan('fixture-floating')).not.toBeNull()
    expect(await repository.getScenario('b')).not.toBeNull()
  })

  it('lists a loan’s scenarios oldest first, via the index', async () => {
    await repository.saveScenario(scenarioFor('L', 'newer', '2026-06-01T00:00:00.000Z'))
    await repository.saveScenario(scenarioFor('L', 'older', '2026-01-01T00:00:00.000Z'))
    await repository.saveScenario(scenarioFor('OTHER', 'elsewhere', '2026-03-01T00:00:00.000Z'))

    expect((await repository.listScenarios('L')).map((entry) => entry.id)).toEqual([
      'older',
      'newer',
    ])
  })

  it('round-trips a scenario’s events exactly', async () => {
    const scenario = scenarioFor('L', 'a', '2026-01-01T00:00:00.000Z')
    await repository.saveScenario(scenario)

    expect(await repository.getScenario('a')).toEqual(scenario)
  })

  it('deletes a scenario without touching its loan', async () => {
    await repository.saveLoan(fixedRateLoan())
    await repository.saveScenario(scenarioFor('fixture-fixed', 'a', '2026-01-01T00:00:00.000Z'))

    await repository.deleteScenario('a')

    expect(await repository.getScenario('a')).toBeNull()
    expect(await repository.getLoan('fixture-fixed')).not.toBeNull()
  })

  it('starts from the documented defaults', async () => {
    expect(await repository.getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('saves and reads settings', async () => {
    await repository.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark', locale: 'fi-FI' })

    const settings = await repository.getSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.locale).toBe('fi-FI')
  })

  it('merges stored settings over the defaults, so an older record still loads', async () => {
    // A settings record written before a field existed must not leave that field undefined.
    await repository.saveSettings({ theme: 'dark' } as never)

    const settings = await repository.getSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.defaultDayCount).toBe(DEFAULT_SETTINGS.defaultDayCount)
    expect(settings.defaultRateProviderId).toBe(DEFAULT_SETTINGS.defaultRateProviderId)
  })

  it('clear empties every table', async () => {
    await repository.saveLoan(fixedRateLoan())
    await repository.saveScenario(scenarioFor('fixture-fixed', 'a', '2026-01-01T00:00:00.000Z'))
    await repository.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })

    await repository.clear()

    expect(await repository.listLoans()).toEqual([])
    expect(await repository.getScenario('a')).toBeNull()
    expect(await repository.getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  describe('when stored data is corrupt', () => {
    it('reports a bad loan record by id rather than returning nonsense', async () => {
      // Data can predate the current code, or arrive from a hand-edited import. Validating
      // on read means one bad record is a named error, not a schedule computed from a
      // malformed loan.
      await repository.saveLoan(fixedRateLoan())

      const raw = indexedDB.open(databaseName)
      await new Promise((resolve) => {
        raw.addEventListener('success', resolve)
      })
      const database = raw.result
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('loans', 'readwrite')
        const request = transaction
          .objectStore('loans')
          .put({ id: 'fixture-fixed', name: 'Broken', principal: 'not-a-number' })
        request.addEventListener('success', resolve)
        request.addEventListener('error', reject)
      })
      database.close()

      await expect(repository.getLoan('fixture-fixed')).rejects.toBeInstanceOf(StorageError)
      await expect(repository.getLoan('fixture-fixed')).rejects.toThrow(/fixture-fixed/)
    })
  })
})
