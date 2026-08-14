# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: Vite 8, React 19, TypeScript in strict mode.
- Tailwind CSS 4 design tokens with light and dark palettes, including semantic chart colours
  for the loan domain (capital, interest, fees, baseline, scenario).
- Theme handling with a pre-paint bootstrap so the first render never flashes the wrong theme.
- oxlint and oxfmt as the lint and format toolchain, with import and Tailwind class sorting.
- Module boundary guard (`npm run check:boundaries`) enforcing that the `domain/`, `rates/` and
  `persistence/` layers stay pure.
- i18n guard (`npm run check:i18n`) enforcing locale parity and rejecting undefined keys.
- Vitest with coverage thresholds on the engine layers.
- `AGENTS.md`, architecture documentation and the ADR log.
- Exact monetary arithmetic in `bigint` minor units, with explicit rounding modes and a
  cent-conserving `allocate`.
- Calendar and day-count module supporting `MONTHLY_NOMINAL`, `ACT/360`, `ACT/365`,
  `30E/360` and `30/360` bond basis.
- Annuity amortization engine: `replay()` produces the full payment schedule with the
  capital, interest, capitalised-interest and fee split for every month, recalculating the
  instalment on rate resets and holding the payoff date.
- Floating-rate support for EURIBOR 1M/3M/6M/12M with margin, reference floor applied
  before the margin, configurable reset cadence and rate rounding.
- Scenario events: one-off and recurring overpayments (shortening the term or lowering the
  payment), payment holidays with paid or capitalised interest, rate overrides, and balance
  corrections that re-anchor the schedule to a real statement.
- Analytics: whole-loan totals, yearly rollups, progress to date, scenario comparison,
  cash-flow break-even and cumulative running totals.
- Reference schedule verified independently against Python's `decimal`, plus property-based
  invariant tests covering exact principal repayment, monotonic balance and per-row
  reconciliation.
- `docs/domain-model.md` documenting the engine and the reasoning behind it.
- Pluggable rate providers behind a `RateProvider` interface, with a registry so a
  user-supplied source resolves for any loan that names it.
- ECB Data Portal provider covering EURIBOR 1M/3M/6M/12M back to January 1999, parsed from
  SDMX CSV with columns located by header name.
- Bundled rate snapshot committed at `public/data/euribor.json` — 1,324 real observations —
  giving a fast first paint, an offline mode and a fallback if the ECB is unreachable.
- Manual provider for fixings the user enters themselves.
- Forecast assumptions for periods past the published data (hold last, basis-point shock,
  fixed rate, explicit curve) plus the shocked variants that drive the sensitivity fan.
  Published fixings are never overwritten by a projection.
- `npm run refresh-rates` to refresh the snapshot, and `npm run check:snapshot` to validate
  the committed file independently of the runtime schema.
- `docs/rate-providers.md` documenting the interface and how to implement one.
- Local-first persistence: `LoanRepository` interface with an IndexedDB implementation via
  Dexie, an in-memory implementation used both in tests and as the fallback when storage is
  unavailable, and automatic selection between them.
- A stored representation kept separate from domain types, with money as decimal minor-unit
  strings so records survive JSON and structured cloning, and validation on read so one
  corrupt record is a named error rather than a malformed loan.
- Versioned, Zod-validated export and import. Merge or replace on import, a refusal to read
  a format newer than the running build, and rejection of a backup whose scenarios reference
  loans it does not contain.
- i18n with i18next: eight namespaces, keys typed from the English resources so a typo is a
  build error, and locale parity enforced in CI.
- Locale-aware formatting through `Intl` throughout. Money reaches the screen as an exact
  decimal string rather than a float, so nothing is lost at the last step.
- Application shell with type-safe routing, theme switching and a skip link, on Tailwind 4 and
  hand-owned shadcn/ui primitives.
- Portfolio view listing every loan with what is still owed, the current instalment and rate,
  the payoff date and repayment progress; per-currency totals once there is more than one loan.
- Loan create and edit form. Day count, rate rounding and the reference floor are first-class
  and explained rather than hidden, because they are what decide whether the model agrees with
  a real statement.
- Payment schedule: virtualised table over the full term with per-row flags for rate resets,
  overpayments and corrections, filters for past and remaining, and a yearly rollup.
- Scenarios: a no-setup comparison of shortening the term against lowering the payment for the
  same overpayment, plus saved scenarios built from overpayments and payment holidays.
- Rate panel showing the source, margin, floor and every reset, with a rate-sensitivity table
  computed by replaying the loan rather than by scaling the baseline.
- Settings with per-loan defaults, the forecast assumption, and export, import and delete.
- Component tests driving the real provider stack — the form is exercised by typing into
  labelled fields and asserting on the `Loan` that comes out.
- Charts, on a palette validated for colour-vision deficiency and surface contrast in both
  light and dark rather than chosen by eye (see
  [ADR 0004](./docs/adr/0004-validated-chart-palette.md)):
  - Headline figures as stat tiles with sparklines.
  - Capital versus interest per instalment over the term, with the crossover month called out.
  - Remaining balance over the life of the loan.
  - Cost per calendar year, split into interest, capital and fees.
  - Lifetime cost as one labelled bar plus the ratio as a hero figure.
  - The reference rate against the rate actually charged, with reset months marked.
  - A single instalment broken into its parts, for any month worth looking at.
  - Total interest at five different rates, coloured by an ordinal ramp.
  - Interest month by month as a heatmap, where a rate reset shows as a whole row shifting.
  - Every chart carries a legend, a keyboard-reachable table view and an accessible name.
- The charts are loaded on demand, so a first visit does not pay for the charting library.

### Changed

- Upgraded to TypeScript 7, `@types/node` 26, `@vitejs/plugin-react` 6 and `lucide-react` 1.
  TypeScript 7 removed `baseUrl`, so path mappings are now written relative to `tsconfig.json`.
- Node baseline raised to 24; CI runs on 24 and 26.
- `npm run check` now runs the coverage-gated test command, matching CI. Previously it ran
  the plain test command, so coverage could fail in CI while the local check passed.

[Unreleased]: https://github.com/visma-zohaib-aslam/LoanLens/commits/main
