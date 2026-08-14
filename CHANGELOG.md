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

[Unreleased]: https://github.com/visma-zohaib-aslam/LoanLens/commits/main
