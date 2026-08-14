import type { RateProvider } from '@/rates/types'

import { describe, expect, it } from 'vitest'

import { yearMonth } from '@/domain/dates'
import { createDefaultRegistry } from '@/rates/index'
import { ECB_PROVIDER_ID } from '@/rates/providers/ecb'
import { SNAPSHOT_PROVIDER_ID } from '@/rates/providers/snapshot'
import { RateProviderRegistry } from '@/rates/registry'
import { RateProviderError } from '@/rates/types'

function fakeProvider(overrides: Partial<RateProvider> = {}): RateProvider {
  return {
    id: 'fake',
    labelKey: 'rates:provider.fake.label',
    supportedTenors: ['12M'],
    earliestPeriod: yearMonth(2010, 1),
    requiresNetwork: false,
    getSeries: ({ tenor }) =>
      Promise.resolve({ providerId: 'fake', tenor, points: [], retrievedAt: null }),
    ...overrides,
  }
}

describe('RateProviderRegistry', () => {
  it('registers and resolves a provider', () => {
    const registry = new RateProviderRegistry().register(fakeProvider())

    expect(registry.has('fake')).toBe(true)
    expect(registry.get('fake').id).toBe('fake')
    expect(registry.list()).toHaveLength(1)
  })

  it('is chainable', () => {
    const registry = new RateProviderRegistry()
      .register(fakeProvider({ id: 'a' }))
      .register(fakeProvider({ id: 'b' }))

    expect(registry.list().map((provider) => provider.id)).toEqual(['a', 'b'])
  })

  it('replaces a provider registered under the same id', () => {
    // How a user overrides a built-in source with their own implementation.
    const registry = new RateProviderRegistry()
      .register(fakeProvider({ id: 'ecb', labelKey: 'first' }))
      .register(fakeProvider({ id: 'ecb', labelKey: 'second' }))

    expect(registry.list()).toHaveLength(1)
    expect(registry.get('ecb').labelKey).toBe('second')
  })

  it('find returns undefined rather than throwing', () => {
    expect(new RateProviderRegistry().find('nope')).toBeUndefined()
  })

  it('get names what is available when it cannot resolve', () => {
    // A loan can outlive the provider it references — imported from another device, or a
    // custom provider not registered this session. The error has to be actionable.
    const registry = new RateProviderRegistry().register(fakeProvider({ id: 'ecb' }))

    expect(() => registry.get('nope')).toThrow(RateProviderError)
    expect(() => registry.get('nope')).toThrow(/Registered: ecb/)
  })

  it('says so plainly when nothing is registered at all', () => {
    expect(() => new RateProviderRegistry().get('ecb')).toThrow(/Registered: none/)
  })

  it('filters by supported tenor', () => {
    const registry = new RateProviderRegistry()
      .register(fakeProvider({ id: 'only12m', supportedTenors: ['12M'] }))
      .register(fakeProvider({ id: 'all', supportedTenors: ['1M', '3M', '6M', '12M'] }))

    expect(registry.supporting('12M').map((provider) => provider.id)).toEqual(['only12m', 'all'])
    expect(registry.supporting('3M').map((provider) => provider.id)).toEqual(['all'])
  })

  it('keeps registries independent, so tests cannot leak into each other', () => {
    const first = new RateProviderRegistry().register(fakeProvider({ id: 'first' }))
    const second = new RateProviderRegistry()

    expect(first.has('first')).toBe(true)
    expect(second.has('first')).toBe(false)
  })
})

describe('createDefaultRegistry', () => {
  const registry = createDefaultRegistry()

  it('ships the ECB and the bundled snapshot', () => {
    expect(registry.has(ECB_PROVIDER_ID)).toBe(true)
    expect(registry.has(SNAPSHOT_PROVIDER_ID)).toBe(true)
  })

  it('marks only the ECB as leaving the device', () => {
    // This drives the privacy note in the UI, so it needs to be right.
    expect(registry.get(ECB_PROVIDER_ID).requiresNetwork).toBe(true)
    expect(registry.get(SNAPSHOT_PROVIDER_ID).requiresNetwork).toBe(false)
  })

  it('covers all four EURIBOR tenors from both sources', () => {
    for (const tenor of ['1M', '3M', '6M', '12M'] as const) {
      expect(registry.supporting(tenor).map((provider) => provider.id)).toEqual([
        ECB_PROVIDER_ID,
        SNAPSHOT_PROVIDER_ID,
      ])
    }
  })

  it('names every provider with an i18n key, never a literal', () => {
    for (const provider of registry.list()) {
      expect(provider.labelKey).toMatch(/^rates:provider\./)
    }
  })
})
