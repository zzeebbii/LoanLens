import { afterEach } from 'vitest'

/**
 * Test setup, loaded before any test module.
 *
 * `fake-indexeddb/auto` installs `indexedDB` on `globalThis`, and it has to run before Dexie
 * is imported — Dexie captures the API at module initialisation and otherwise throws
 * `MissingAPIError`. Importing it at the top of a test file does not reliably work: module
 * imports are hoisted and evaluated in dependency order, and the formatter sorts side-effect
 * imports last, so the shim would land after the code that needs it. A setup file removes the
 * ordering question entirely.
 */
import 'fake-indexeddb/auto'

/**
 * DOM-only setup, applied when a test file opts into the jsdom environment.
 *
 * Guarded because most suites here run in `node` — the engine, the rate providers, and
 * persistence have no DOM and are faster without one. Importing Testing Library
 * unconditionally would fail in those files.
 */
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  await import('@testing-library/jest-dom/vitest')

  /**
   * Testing Library only unmounts automatically when Vitest runs with `globals: true`, which
   * this project does not. Without this, every rendered tree stays in the document and the
   * next test's queries match leftovers from the previous one — which surfaces as "found
   * multiple elements" on assertions that are perfectly correct.
   */
  afterEach(cleanup)

  /**
   * Browser APIs jsdom does not implement, which the Radix primitives rely on.
   *
   * These are stubs, not implementations: nothing under test depends on real measurements or
   * real pointer capture. Without them, rendering anything containing a Switch or a Select
   * throws before a single assertion runs — a missing environment feature masquerading as a
   * component bug.
   */
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.DOMRect ??= class {
    constructor(
      readonly x = 0,
      readonly y = 0,
      readonly width = 0,
      readonly height = 0,
    ) {}
    readonly top = 0
    readonly left = 0
    readonly right = 0
    readonly bottom = 0
    toJSON() {
      return {}
    }
    static fromRect() {
      return new DOMRect()
    }
  } as unknown as typeof DOMRect

  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}
