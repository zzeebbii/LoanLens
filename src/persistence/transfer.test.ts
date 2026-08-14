import type { Scenario } from '@/domain/scenario'

import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { fromMajorUnits, toCents } from '@/domain/money'
import { fixedRateLoan, floatingRateLoan } from '@/domain/testing/fixtures'
import { InMemoryLoanRepository } from '@/persistence/memory'
import { DEFAULT_SETTINGS, StorageError } from '@/persistence/repository'
import { fromStoredLoan, toStoredLoan } from '@/persistence/schema'
import {
  applyImport,
  buildExport,
  collectExport,
  EXPORT_SCHEMA_VERSION,
  exportFilename,
  ImportError,
  parseImport,
  parseImportJson,
  serialiseExport,
} from '@/persistence/transfer'

const now = () => new Date('2026-08-14T12:00:00.000Z')

const scenario: Scenario = {
  id: 'scenario-1',
  loanId: 'fixture-floating',
  name: '+200/mo from September',
  events: [
    {
      kind: 'RECURRING_EXTRA',
      from: yearMonth(2026, 9),
      until: null,
      amount: fromMajorUnits(200),
      effect: 'SHORTEN_TERM',
    },
    {
      kind: 'BALANCE_CORRECTION',
      period: yearMonth(2026, 6),
      closingBalance: fromMajorUnits(198_432.17),
    },
  ],
  createdAt: '2026-08-01T00:00:00.000Z',
}

const bundle = {
  loans: [floatingRateLoan(), fixedRateLoan()],
  scenarios: [scenario],
  settings: DEFAULT_SETTINGS,
}

describe('the stored representation', () => {
  it('survives a JSON round trip, which a bigint would not', () => {
    // JSON.stringify(1n) throws. Money is stored as decimal minor units precisely so an
    // export file is serialisable at all.
    const stored = toStoredLoan(floatingRateLoan())
    expect(() => JSON.stringify(stored)).not.toThrow()
    expect(stored.principal).toBe('25000000')
  })

  it('round-trips a loan exactly', () => {
    const original = floatingRateLoan({ monthlyServicing: fromMajorUnits(2.5) })
    expect(fromStoredLoan(toStoredLoan(original))).toEqual(original)
  })

  it('round-trips a fixed-rate loan exactly', () => {
    const original = fixedRateLoan()
    expect(fromStoredLoan(toStoredLoan(original))).toEqual(original)
  })

  it('keeps money exact to the cent through the round trip', () => {
    const original = fixedRateLoan({ principal: fromMajorUnits(123_456.78) })
    expect(toCents(fromStoredLoan(toStoredLoan(original)).principal)).toBe(12_345_678n)
  })
})

describe('buildExport', () => {
  const file = buildExport(bundle, now)

  it('identifies itself so a wrong file can be rejected', () => {
    expect(file.application).toBe('LoanLens')
    expect(file.schemaVersion).toBe(EXPORT_SCHEMA_VERSION)
    expect(file.exportedAt).toBe('2026-08-14T12:00:00.000Z')
  })

  it('includes every loan, scenario and setting', () => {
    expect(file.loans).toHaveLength(2)
    expect(file.scenarios).toHaveLength(1)
    expect(file.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('serialises to readable, indented JSON', () => {
    // This file is the user's only backup. Being able to open and, at a pinch, repair it
    // by hand is worth more than the bytes.
    const text = serialiseExport(file)
    expect(text).toContain('\n  "application": "LoanLens"')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('names the file so backups sort chronologically', () => {
    expect(exportFilename(now)).toBe('loanlens-backup-2026-08-14.json')
  })
})

describe('parseImport', () => {
  it('round-trips a full export', () => {
    const parsed = parseImport(buildExport(bundle, now))

    expect(parsed.loans).toEqual(bundle.loans)
    expect(parsed.scenarios).toEqual(bundle.scenarios)
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips through serialised JSON', () => {
    const parsed = parseImportJson(serialiseExport(buildExport(bundle, now)))
    expect(parsed.loans).toEqual(bundle.loans)
    expect(
      toCents(
        parsed.scenarios[0]!.events[1]!.kind === 'BALANCE_CORRECTION'
          ? parsed.scenarios[0]!.events[1]!.closingBalance
          : fromMajorUnits(0),
      ),
    ).toBe(19_843_217n)
  })

  it('distinguishes malformed JSON from a valid-JSON wrong shape', () => {
    expect(() => parseImportJson('{not json')).toThrow(/not valid JSON/)
    expect(() => parseImportJson('{"application":"Something"}')).toThrow(/not a LoanLens backup/)
  })

  it('rejects a file from another application', () => {
    expect(() => parseImport({ ...buildExport(bundle, now), application: 'OtherApp' })).toThrow(
      ImportError,
    )
  })

  it('refuses a newer format rather than importing part of it', () => {
    // A newer file may carry fields this build would drop. A silent partial import loses
    // data the user believes is backed up.
    expect(() => parseImport({ ...buildExport(bundle, now), schemaVersion: 99 })).toThrow(
      /newer version/,
    )
  })

  it('accepts an older format', () => {
    // Only the current version exists so far, but the path has to be open from the start.
    expect(() =>
      parseImport({ ...buildExport(bundle, now), schemaVersion: EXPORT_SCHEMA_VERSION }),
    ).not.toThrow()
  })

  it('reports several problems at once, not just the first', () => {
    try {
      parseImport({
        application: 'LoanLens',
        schemaVersion: 1,
        exportedAt: '2026-08-14',
        loans: [{ id: 'x' }, { id: 'y' }],
        scenarios: [],
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError)
      expect((error as ImportError).issues.length).toBeGreaterThan(1)
    }
  })

  it('rejects a scenario whose loan is not in the file', () => {
    // An orphaned scenario has nothing to compare against, and importing it would create
    // a record the user can never open.
    expect(() =>
      parseImport({
        ...buildExport({ ...bundle, loans: [] }, now),
      }),
    ).toThrow(/internally inconsistent/)
  })

  it('names the orphaned scenario so the user can find it', () => {
    try {
      parseImport(buildExport({ ...bundle, loans: [] }, now))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ImportError).issues[0]).toContain('+200/mo from September')
    }
  })

  it('rejects money that is not whole minor units', () => {
    const file = buildExport(bundle, now)
    const damaged = {
      ...file,
      loans: [{ ...file.loans[0]!, principal: '250000.00' }, ...file.loans.slice(1)],
    }

    expect(() => parseImport(damaged)).toThrow(ImportError)
    try {
      parseImport(damaged)
      expect.unreachable('should have thrown')
    } catch (error) {
      // The message stays generic for the user; the specifics live in `issues`, which the
      // UI shows underneath it.
      expect((error as ImportError).issues.join('\n')).toMatch(/loans\.0\.principal.*minor units/)
    }
  })

  it('rejects an impossible date', () => {
    const file = buildExport(bundle, now)
    const damaged = {
      ...file,
      loans: [{ ...file.loans[0]!, drawdownDate: '2021-02-30' }, ...file.loans.slice(1)],
    }
    expect(() => parseImport(damaged)).toThrow(ImportError)
  })

  it('fills in settings absent from an older file', () => {
    const { settings: _omitted, ...withoutSettings } = buildExport(bundle, now)
    expect(parseImport(withoutSettings).settings).toEqual(DEFAULT_SETTINGS)
  })
})

describe('applyImport', () => {
  it('MERGE adds to what is already there', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveLoan(fixedRateLoan({ ...fixedRateLoan(), name: 'Existing' }))

    const result = await applyImport(repository, parseImport(buildExport(bundle, now)), 'MERGE')

    expect(result.mode).toBe('MERGE')
    expect(result.loansImported).toBe(2)
    // 'fixture-fixed' is overwritten by id; 'fixture-floating' is added.
    expect(await repository.listLoans()).toHaveLength(2)
  })

  it('REPLACE wipes first', async () => {
    const repository = new InMemoryLoanRepository()
    await repository.saveLoan(fixedRateLoan({ principal: fromMajorUnits(1) }))
    await repository.saveScenario({ ...scenario, id: 'stale', loanId: 'fixture-fixed' })

    await applyImport(repository, parseImport(buildExport(bundle, now)), 'REPLACE')

    expect(await repository.listLoans()).toHaveLength(2)
    expect(await repository.getScenario('stale')).toBeNull()
    expect(await repository.getScenario('scenario-1')).not.toBeNull()
  })

  it('restores the exact loan that was exported', async () => {
    const repository = new InMemoryLoanRepository()
    await applyImport(repository, parseImport(buildExport(bundle, now)), 'REPLACE')

    expect(await repository.getLoan('fixture-floating')).toEqual(floatingRateLoan())
  })

  it('reports a storage failure as a StorageError', async () => {
    const failing = new InMemoryLoanRepository()
    failing.saveLoan = () => Promise.reject(new Error('quota exceeded'))

    await expect(
      applyImport(failing, parseImport(buildExport(bundle, now)), 'MERGE'),
    ).rejects.toBeInstanceOf(StorageError)
  })
})

describe('collectExport', () => {
  it('reads back everything that was saved', async () => {
    const repository = new InMemoryLoanRepository()
    await Promise.all(bundle.loans.map((loan) => repository.saveLoan(loan)))
    await repository.saveScenario(scenario)

    const collected = await collectExport(repository)

    expect(collected.loans).toHaveLength(2)
    expect(collected.scenarios).toEqual([scenario])
    expect(collected.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('completes a full export, clear, import cycle with nothing lost', async () => {
    // The manual verification step from the plan, as a test.
    const repository = new InMemoryLoanRepository()
    await Promise.all(bundle.loans.map((loan) => repository.saveLoan(loan)))
    await repository.saveScenario(scenario)

    const text = serialiseExport(buildExport(await collectExport(repository), now))
    await repository.clear()
    expect(await repository.listLoans()).toEqual([])

    await applyImport(repository, parseImportJson(text), 'REPLACE')

    expect(await repository.listLoans()).toHaveLength(2)
    expect(await repository.listScenarios('fixture-floating')).toEqual([scenario])
  })

  it('exports nothing gracefully from an empty repository', async () => {
    const collected = await collectExport(new InMemoryLoanRepository())
    expect(collected.loans).toEqual([])
    expect(collected.scenarios).toEqual([])
  })
})
