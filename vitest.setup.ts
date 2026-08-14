/**
 * Test setup, loaded before any test module.
 *
 * `fake-indexeddb/auto` installs `indexedDB` on `globalThis`, and it has to run before
 * Dexie is imported — Dexie captures the API at module initialisation and otherwise throws
 * `MissingAPIError`. Importing it at the top of a test file does not reliably work: module
 * imports are hoisted and evaluated in dependency order, and the formatter sorts
 * side-effect imports last, so the shim would land after the code that needs it. A setup
 * file removes the ordering question entirely.
 */
import 'fake-indexeddb/auto'
