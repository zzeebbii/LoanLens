# AGENTS.md

Instructions for automated agents working on LoanLens. Read this before touching anything.

## What this project is

LoanLens gives one person insight into one thing: their EURIBOR-linked home loan. It
reconstructs what the loan has cost so far from real historic rate data, projects the rest of
the term, and models what extra payments would change.

It is a **static, local-first web app**. There is no backend and there will not be one. It
deploys to GitHub Pages. Loan data lives in the user's browser and never leaves it — the only
outbound request is to the ECB's public rate API, which carries no personal data.

## The rules that are not negotiable

### 1. Money is `bigint` minor units. Never floats.

A 30-year loan is 360 compounding steps. IEEE-754 drift across that many steps produces cent
errors the user will see when they compare against a bank statement, and it makes exact
assertions like "the sum of all capital equals the principal" impossible to write.

Use `Money` from `src/domain/money.ts` everywhere — schedules, totals, chart data, form state.
Convert to `number` only at the last moment, inside a formatter, for display.

```ts
// wrong
const interest = balance * monthlyRate

// right
const interest = multiplyByRate(balance, monthlyRate)
```

### 2. `domain/`, `rates/` and `persistence/` are pure layers.

`src/domain/` is plain TypeScript with **zero dependencies**. No React, no DOM, no npm
packages, no Node builtins. It must run anywhere. `rates/` and `persistence/` have narrow,
explicit allowlists.

This is enforced by `npm run check:boundaries`, not by good intentions. If you need a new
dependency in a pure layer, change the allowlist in `scripts/check-boundaries.mjs` in the same
commit so the decision is visible in review — do not work around the check.

Rates are **injected** into the engine as a `(period) => Rate` function. `domain/` must never
learn that the ECB exists.

### 3. No user-facing string is hardcoded.

Every string a user can read comes from an i18n key. English is the base locale; other locales
must cover exactly the same key set. `npm run check:i18n` fails the build on a missing key, a
drifted locale, or a key referenced in code but absent from the base locale.

Numbers, currency and dates go through `Intl` — never hand-rolled formatting, never a hardcoded
`€` or `.`/`,` decimal separator.

The single exception is the product name "LoanLens", a proper noun.

### 4. The domain layer is written test-first.

Write the failing test, then the implementation. The engine is the part of this app that must
not be wrong; every other defect is cosmetic by comparison. Coverage thresholds on
`domain/`, `rates/` and `persistence/` are enforced in `vitest.config.ts`.

Prefer invariants over example-based tests where you can express them. The engine has strong
ones, and `fast-check` is already installed:

- the sum of every capital portion equals the principal, exactly
- the balance is monotonically non-increasing
- the final balance is exactly zero
- total paid equals principal + total interest + total fees, exactly

### 5. Charts go through the chart layer.

Never import Recharts directly in a feature. Build on `src/components/charts/`, and take colours
from the CSS custom properties defined in `src/styles/index.css` (`--chart-capital`,
`--chart-interest`, …). A hardcoded hex in a chart is a bug: it will be wrong in one of the two
themes.

Every chart needs a keyboard-reachable interaction path and a data-table fallback.

## Commands

```bash
npm run dev              # dev server
npm run check            # everything CI runs — must pass before any commit
npm run test:watch       # TDD loop
npm run lint:fix         # oxlint autofix
npm run format           # oxfmt write (also sorts imports and Tailwind classes)
```

`npm run check` = format check → lint → typecheck → boundaries → i18n → rate snapshot →
tests with coverage → build. It runs exactly what CI runs, deliberately: when the two drift,
the local check stops being worth trusting.

**Run it before every commit.** Do not commit with a red check and a note to fix it later.

One practical note: do not run a second test command in the background while `npm run check`
is going. Both spawn worker pools, and the contention can turn a one-second suite into
several minutes — which looks exactly like a performance bug in the code.

## Conventions

**Commits** follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. Scope with the layer where it
helps: `feat(domain): model payment holidays`.

**CHANGELOG.md** follows [Keep a Changelog](https://keepachangelog.com/). Any user-visible
change adds a line under `## [Unreleased]` in the same commit that makes the change. Internal
refactors and dependency bumps do not.

**Architectural decisions** get an ADR in `docs/adr/`, numbered sequentially, using the existing
template. Write one when you choose between real alternatives — a library, a data model, a
boundary. Do not write one for routine implementation work.

**`docs/architecture.md`** is the map. If you add a layer, move a boundary, or change how data
flows, update it in the same PR. A stale architecture doc is worse than none.

**Formatting is not a matter of taste.** oxfmt owns it. Do not hand-format; do not argue with
it in review.

## Working style

- Read `docs/architecture.md` and `docs/domain-model.md` before changing the engine.
- Prefer extending an existing module to adding a parallel one. Check what exists first.
- When you find an assumption you cannot verify (a day-count convention, a bank's rounding
  rule), encode it as an explicit, named, documented option with a stated default — do not bury
  a guess in an expression.
- Comment _why_, not _what_. The domain layer is where this matters most: the formula is
  visible in the code, but the reason a bank recalculates on the reset date rather than the
  payment date is not.
- If a task is blocked or a requirement is ambiguous in a way that changes the output, say so
  rather than guessing and moving on.
