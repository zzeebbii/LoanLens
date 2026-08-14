# Architecture

> Keep this current. If you move a boundary or change how data flows, update this file in the
> same PR. See `AGENTS.md` for the rules this document explains.

## Shape of the system

LoanLens is a single-page application with no backend. Everything runs in the browser:

```
┌──────────────────────────── browser ─────────────────────────────┐
│                                                                  │
│   features/ ──▶ components/ ──▶ charts/                          │
│       │                                                          │
│       ├──▶ persistence/ ──▶ IndexedDB    (loans, scenarios)      │
│       │                                                          │
│       ├──▶ rates/ ────────▶ ECB Data Portal API   (public HTTPS) │
│       │                └──▶ bundled snapshot JSON  (fallback)    │
│       │                                                          │
│       └──▶ domain/       (pure engine — no I/O at all)           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The only network call the app makes is to `data-api.ecb.europa.eu`. It sends no personal data:
the request asks for a public interest-rate series and nothing else. Loan figures never leave
the device.

## Layers

Layers are ordered by purity. Each may only import from itself and the layers below it. This is
enforced by `scripts/check-boundaries.mjs`, which runs in `npm run check` and in CI.

| Layer                          | May import          | Purpose                                              |
| ------------------------------ | ------------------- | ---------------------------------------------------- |
| `domain/`                      | _nothing_           | The financial engine. Pure functions over pure data. |
| `rates/`                       | `domain/`           | Rate-provider abstraction and implementations.       |
| `persistence/`                 | `domain/`, `rates/` | Storing and transferring user data.                  |
| `i18n/`, `lib/`, `components/` | lower layers        | Cross-cutting UI concerns.                           |
| `features/`, `app/`            | anything            | Screens, routing, composition.                       |

### `domain/` — the engine

Zero dependencies. No React, no DOM, no npm packages, no Node builtins. It could be lifted into
a CLI or a spreadsheet add-in unchanged, and it is testable without rendering anything.

Its core is one function:

```ts
replay(loan: Loan, rateAt: (period: YearMonth) => Rate, events: LoanEvent[]): PaymentRow[]
```

Everything the app displays — tables, totals, all eleven charts — is derived from the
`PaymentRow[]` this returns. Scenarios are not a special case: a scenario is the same `replay`
with a different `events` array, and comparisons are two result sets diffed.

Rates arrive as an **injected function**, not a fetch. That is the single decision that keeps
the engine pure, makes it synchronous, and makes every test deterministic without mocking a
network.

### `rates/` — pluggable rate sources

Rate data is behind a `RateProvider` interface so a user can add their own source (a different
index, a national statistics API, a spreadsheet) without touching the engine. Implementations
that ship:

- **`ecb`** — ECB Data Portal, the default. Monthly EURIBOR 1M/3M/6M/12M back to 1999-01.
- **`snapshot`** — a JSON file committed to the repo and refreshed by a scheduled workflow.
  Gives a fast first paint and keeps the app usable when the ECB API is unreachable.
- **`manual`** — a rate curve the user types in, for loans whose reference the app cannot fetch.

See `docs/rate-providers.md` for the interface and how to implement one.

### `persistence/` — local-only storage

`LoanRepository` is an interface; `IndexedDbRepository` (Dexie) is the implementation. Keeping
the interface means the storage mechanism is swappable and, more usefully, that the whole app
can be tested against an in-memory repository.

Export and import use a **versioned, Zod-validated** file schema. Version the schema from the
first release: users will accumulate data, and a migration path added later is a migration path
added too late.

### `features/` — screens

Each feature owns its components, hooks and local state. Features do not import from each
other; anything shared moves down into `components/` or `lib/`.

### `app/hooks/` — where async meets pure

Two hooks carry the whole boundary described in ADR 0001:

- **`useRateSeries`** does everything asynchronous — fetching, caching, falling back to the
  bundled snapshot, applying the forecast — and hands back a plain
  `(period, index) => number | null`.
- **`useSchedule`** is a `useMemo`, not a query. `replay` is pure and synchronous, so there is
  no loading state, no race and no stale result to manage.

Expected engine refusals — a missing rate, a loan that cannot amortise — are _returned_ from
`useSchedule` rather than thrown. They are outcomes of user input with a control that fixes
them, not defects; the error boundary is for actual bugs.

### `components/charts/` — the chart layer

Charts never import Recharts directly from a feature, and never write a colour as a hex.
Colours come from `palette.ts` as `var(--…)` references to the tokens in
`src/styles/index.css`, which were validated rather than chosen — see
[ADR 0004](./adr/0004-validated-chart-palette.md).

`ChartFrame` is what makes the accessibility contract structural rather than remembered: it
renders a legend for any chart with two or more series, offers a table view carrying every
value a tooltip would show, and names the region.

## Data flow

```
IndexedDB ──▶ Loan ─────┐
                        ├──▶ replay() ──▶ PaymentRow[] ──▶ analytics() ──▶ charts + tables
ECB API ──▶ RateSeries ─┘         ▲
                                  │
              scenario events ────┘
```

Reads flow down, results flow up. Nothing in `domain/` calls anything above it.

## Why these boundaries

The engine is the part of this app that must not be wrong. A wrong colour is noticed and fixed;
a wrong interest calculation is _trusted_ and acted on. Keeping the engine pure means it can be
exhaustively tested with property-based tests, reasoned about without a browser, and reviewed
without wading through JSX.

The boundary also keeps the app honest about I/O: because rates are injected, there is no place
for a fetch to hide inside a calculation, and no calculation whose result depends on when it ran.

## Deployment

GitHub Pages, from `main`, via GitHub Actions. The deploy runs the full `npm run check` gate
before building — a deploy that skips the checks is a deploy that can publish a red build.

Two details the Pages environment forces:

- **`BASE_PATH`** comes from `actions/configure-pages`, so asset URLs and the bundled
  snapshot URL match wherever Pages actually serves the site.
- **`index.html` is copied to `404.html`.** Pages has no rewrite rules, so a refresh on
  `/loans/<id>` would 404; serving the same document as the not-found page hands the URL to
  the client-side router.

The charts tab is loaded on demand. Recharts is around 420 kB — a third of the bundle — and
nothing outside that tab needs it, so a first visit does not pay for it.

A Dockerfile builds the same static output and serves it behind nginx, for running the app
without a Node toolchain. `BASE_PATH=/` there, since nginx serves from the root.

The rate snapshot is refreshed by a scheduled workflow on the 3rd of each month. It commits
only when the observations changed, writes nothing if any tenor fails, and validates the file
before committing.

## Decisions

Significant choices are recorded in [`docs/adr/`](./adr/). Start there when a piece of the
design looks arbitrary — it is usually load-bearing.
