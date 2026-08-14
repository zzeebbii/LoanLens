import type { Tenor } from '@/domain/loan'
import type { RateProvider } from '@/rates/types'

import { RateProviderError } from '@/rates/types'

/**
 * The registry of rate providers.
 *
 * A registry rather than a hardcoded list because plugging in your own source is a stated
 * goal: implement `RateProvider`, register it, and it appears in the UI and resolves for
 * any loan that names it. Nothing in `domain/` changes.
 *
 * Instance-based rather than module-global so tests get a clean registry and never leak
 * state into each other.
 */
export class RateProviderRegistry {
  private readonly providers = new Map<string, RateProvider>()

  /** Registers a provider, replacing any existing one with the same id. */
  register(provider: RateProvider): this {
    this.providers.set(provider.id, provider)
    return this
  }

  /** @returns the provider, or `undefined` if nothing is registered under `id`. */
  find(id: string): RateProvider | undefined {
    return this.providers.get(id)
  }

  /**
   * @throws RateProviderError naming the ids that *are* available.
   *
   * A loan can outlive the provider it references — an import from another device, a
   * custom provider that was not registered this session — so the failure needs to say
   * what went wrong rather than surface as an undefined further down.
   */
  get(id: string): RateProvider {
    const provider = this.providers.get(id)
    if (provider === undefined) {
      const available = [...this.providers.keys()]
      throw new RateProviderError(
        id,
        `No such rate provider. Registered: ${available.length > 0 ? available.join(', ') : 'none'}.`,
      )
    }
    return provider
  }

  list(): RateProvider[] {
    return [...this.providers.values()]
  }

  /** Providers that can serve a given tenor, for filtering the UI's options. */
  supporting(tenor: Tenor): RateProvider[] {
    return this.list().filter((provider) => provider.supportedTenors.includes(tenor))
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }
}
