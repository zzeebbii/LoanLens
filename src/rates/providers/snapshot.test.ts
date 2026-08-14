import type { RateSnapshot } from '@/rates/providers/snapshot'

import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import {
  createSnapshotProvider,
  parseSnapshot,
  SNAPSHOT_PROVIDER_ID,
} from '@/rates/providers/snapshot'
import { rateAt } from '@/rates/series'
import { RateProviderError } from '@/rates/types'

const snapshot: RateSnapshot = {
  schemaVersion: 1,
  source: 'ECB Data Portal',
  retrievedAt: '2026-08-01T04:35:04.000Z',
  series: {
    '12M': [
      { period: '2021-01', ratePercent: -0.5047 },
      { period: '2022-06', ratePercent: 0.852 },
      { period: '2026-07', ratePercent: 2.855_087 },
    ],
    '3M': [{ period: '2026-07', ratePercent: 2.425_391_3 }],
  },
}

const jsonFetch =
  (body: unknown, status = 200): typeof globalThis.fetch =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )

describe('parseSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    expect(parseSnapshot(snapshot).source).toBe('ECB Data Portal')
  })

  it('rejects a snapshot missing its version', () => {
    const { schemaVersion: _omitted, ...withoutVersion } = snapshot
    expect(() => parseSnapshot(withoutVersion)).toThrow(RateProviderError)
  })

  it('rejects a future schema version rather than guessing at it', () => {
    expect(() => parseSnapshot({ ...snapshot, schemaVersion: 2 })).toThrow(/invalid/i)
  })

  it('rejects an empty series, which is what a failed refresh looks like', () => {
    // A truncated deploy or a half-finished refresh must not compute a schedule from
    // nothing. Better a clear error than a plausible-looking wrong number.
    expect(() => parseSnapshot({ ...snapshot, series: { '12M': [] } })).toThrow(RateProviderError)
  })

  it('rejects a rate whose units are obviously wrong', () => {
    // 285.5087 would be the fraction written where a percentage belongs — a 28,550%
    // interest rate. Out of range by a wide margin, and worth catching at the boundary.
    expect(() =>
      parseSnapshot({
        ...snapshot,
        series: { '12M': [{ period: '2026-07', ratePercent: 2855.087 }] },
      }),
    ).toThrow(RateProviderError)
  })

  it('rejects a malformed period', () => {
    expect(() =>
      parseSnapshot({ ...snapshot, series: { '12M': [{ period: '2026-13', ratePercent: 2.8 }] } }),
    ).toThrow(/YYYY-MM/)
  })

  it('rejects an unknown tenor', () => {
    expect(() =>
      parseSnapshot({ ...snapshot, series: { '9M': [{ period: '2026-07', ratePercent: 2.8 }] } }),
    ).toThrow(RateProviderError)
  })

  it('names the offending field so the failure is actionable', () => {
    expect(() =>
      parseSnapshot({ ...snapshot, series: { '12M': [{ period: '2026-13', ratePercent: 2.8 }] } }),
    ).toThrow(/series/)
  })
})

describe('createSnapshotProvider', () => {
  it('serves a pre-loaded snapshot without any fetch', async () => {
    const provider = createSnapshotProvider({ snapshot })
    const series = await provider.getSeries({
      tenor: '12M',
      from: yearMonth(1999, 1),
      to: yearMonth(2030, 1),
    })

    expect(series.points).toHaveLength(3)
    expect(series.retrievedAt).toBe('2026-08-01T04:35:04.000Z')
  })

  it('converts stored percentages to the fractions the engine expects', async () => {
    const provider = createSnapshotProvider({ snapshot })
    const series = await provider.getSeries({
      tenor: '12M',
      from: yearMonth(1999, 1),
      to: yearMonth(2030, 1),
    })

    expect(rateAt(series, yearMonth(2026, 7))).toBeCloseTo(0.028_550_87, 12)
    expect(rateAt(series, yearMonth(2021, 6))).toBeCloseTo(-0.005_047, 12)
  })

  it('makes no network request, so nothing leaves the device', () => {
    expect(createSnapshotProvider({ snapshot }).requiresNetwork).toBe(false)
  })

  it('restricts the result to the requested range', async () => {
    const provider = createSnapshotProvider({ snapshot })
    const series = await provider.getSeries({
      tenor: '12M',
      from: yearMonth(2022, 1),
      to: yearMonth(2023, 1),
    })
    expect(series.points.map((point) => point.period)).toEqual([yearMonth(2022, 6)])
  })

  it('fetches and validates the committed file', async () => {
    const provider = createSnapshotProvider({
      url: 'data/euribor.json',
      fetch: jsonFetch(snapshot),
    })
    const series = await provider.getSeries({
      tenor: '12M',
      from: yearMonth(1999, 1),
      to: yearMonth(2030, 1),
    })
    expect(series.points).toHaveLength(3)
  })

  it('fetches the file only once across many requests', async () => {
    let calls = 0
    const counting: typeof globalThis.fetch = () => {
      calls += 1
      return Promise.resolve(new Response(JSON.stringify(snapshot), { status: 200 }))
    }
    const provider = createSnapshotProvider({ fetch: counting })
    const range = { from: yearMonth(1999, 1), to: yearMonth(2030, 1) }

    await Promise.all([
      provider.getSeries({ tenor: '12M', ...range }),
      provider.getSeries({ tenor: '3M', ...range }),
    ])
    await provider.getSeries({ tenor: '12M', ...range })

    expect(calls).toBe(1)
  })

  it('does not cache a failure, so a transient error is recoverable', async () => {
    let calls = 0
    const flaky: typeof globalThis.fetch = () => {
      calls += 1
      return calls === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(new Response(JSON.stringify(snapshot), { status: 200 }))
    }
    const provider = createSnapshotProvider({ fetch: flaky })
    const range = { from: yearMonth(1999, 1), to: yearMonth(2030, 1) }

    await expect(provider.getSeries({ tenor: '12M', ...range })).rejects.toThrow(RateProviderError)
    // A single blip must not disable the offline fallback for the whole session.
    await expect(provider.getSeries({ tenor: '12M', ...range })).resolves.toBeDefined()
    expect(calls).toBe(2)
  })

  it('reports an HTTP failure with the status', async () => {
    const provider = createSnapshotProvider({ fetch: jsonFetch({}, 404) })
    await expect(
      provider.getSeries({ tenor: '12M', from: yearMonth(1999, 1), to: yearMonth(2030, 1) }),
    ).rejects.toThrow(/404/)
  })

  it('reports a tenor the snapshot does not carry', async () => {
    const provider = createSnapshotProvider({ snapshot })
    await expect(
      provider.getSeries({ tenor: '6M', from: yearMonth(1999, 1), to: yearMonth(2030, 1) }),
    ).rejects.toThrow(/no 6M series/i)
  })

  it('identifies itself', () => {
    expect(createSnapshotProvider({ snapshot }).id).toBe(SNAPSHOT_PROVIDER_ID)
  })
})
