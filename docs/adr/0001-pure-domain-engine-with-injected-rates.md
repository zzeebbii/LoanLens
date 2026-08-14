# ADR 0001: A pure domain engine with injected rates

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

LoanLens exists to answer questions about money: what the loan has cost, what it will cost,
what an extra payment changes. A wrong colour in this app is noticed and fixed. A wrong
interest figure is _believed_, and acted on. The calculation layer therefore carries a
different standard of correctness than the rest of the app.

Two things make loan maths hard to test well when it is tangled up with the UI:

1. **It needs external data.** Interest for any month depends on a EURIBOR fixing. If the
   engine fetches that itself, every test needs a network mock, and results depend on when the
   test ran.
2. **It is long-running and compounding.** A 30-year loan is 360 dependent steps. Errors do not
   stay local; they accumulate into the totals the user compares against their bank statement.

The app must also let users plug in their own rate sources, which is impossible if the source
is hardcoded into the calculation.

## Decision

`src/domain/` is pure TypeScript with zero dependencies — no React, no DOM, no npm packages, no
Node builtins — and its core is a single synchronous function:

```ts
replay(loan: Loan, rateAt: (period: YearMonth) => Rate, events: LoanEvent[]): PaymentRow[]
```

Rates are **injected as a function**. The engine never fetches, never awaits, and does not know
that the ECB exists. Fetching lives in `src/rates/`, behind a `RateProvider` interface.

The boundary is enforced mechanically by `scripts/check-boundaries.mjs`, which runs in
`npm run check` and in CI, rather than by convention.

## Consequences

**Easier.** The engine is deterministic and synchronous, so tests need no mocks, no fake
timers, and no network. That makes property-based testing practical: we can assert that the sum
of capital portions equals the principal _exactly_, that the balance never increases, and that
the final balance is exactly zero — across thousands of generated loans. Scenarios stop being a
feature and become a parameter: a what-if is the same `replay` with a different `events` array,
so comparison is just diffing two result sets. The engine is portable to a CLI or a worker
unchanged.

**Harder.** Callers must resolve rates before calling the engine, which means the UI carries the
async complexity the engine refuses. Future-dated months have no fixing at all, so the caller
must supply an explicit forecast assumption — the engine will not silently invent one. That is
more work at the call site, and it is the point: the assumption becomes visible and selectable
by the user instead of buried in a default.

Adding a dependency to `domain/` now requires editing the boundary allowlist, which shows up in
review. This is deliberate friction.

## Alternatives considered

**Let the engine fetch rates and be async.** Simplest to call, but it makes every engine test a
network test, makes results time-dependent, and would have to be threaded through every
scenario recomputation — including the rate-sensitivity fan, which replays the loan many times
over.

**Pass a pre-resolved `Map<YearMonth, Rate>` instead of a function.** Nearly as good, and
tempting. Rejected because a function also expresses _derived_ rates cleanly — a stress scenario
is `(p) => base(p) + 0.02`, and a forecast is a function over periods with no data. A map would
force the caller to materialise every future month up front for each scenario.

**A calculation service class with injected dependencies.** More ceremony for no gain. The
engine has no state to hold between calls, and a free function composes better with `useMemo`
and with workers.
