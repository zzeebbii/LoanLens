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

### Changed

- Upgraded to TypeScript 7, `@types/node` 26, `@vitejs/plugin-react` 6 and `lucide-react` 1.
  TypeScript 7 removed `baseUrl`, so path mappings are now written relative to `tsconfig.json`.
- Node baseline raised to 24; CI runs on 24 and 26.

[Unreleased]: https://github.com/visma-zohaib-aslam/LoanLens/commits/main
