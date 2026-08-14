# ADR 0002: Money as `bigint` minor units

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The engine walks 360 compounding steps for a 30-year loan, and each step's balance feeds the
next. Two properties matter:

1. **The totals must match a bank statement.** The user's acceptance test for this app is
   comparing its reconstructed history against real statements. A drift of a few cents makes
   that comparison useless, because a genuine modelling error becomes indistinguishable from
   accumulated float noise.
2. **The invariants must be exactly assertable.** The strongest tests available here are
   equalities: the capital portions sum to the principal; the final balance is zero; total paid
   equals principal plus interest plus fees. With floats these become
   `expect(x).toBeCloseTo(y)` with a tolerance nobody can justify, which is precisely the
   assertion that would let a real bug through.

JavaScript numbers are IEEE-754 doubles. `0.1 + 0.2 !== 0.3` is the familiar symptom; the one
that matters here is that repeated multiply-and-subtract over hundreds of iterations
accumulates error in the direction of the operations, not randomly.

## Decision

All monetary amounts are represented as `bigint` counts of minor units (cents), in a `Money`
type defined in `src/domain/money.ts`. Arithmetic goes through that module, which owns rounding
and provides an explicit `allocate` for splitting an amount without losing or inventing cents.

Interest rates stay as `number` — they are ratios, not amounts, and the rounding decision
happens when a rate meets an amount. That single crossing point is inside `Money`, where the
rounding rule is named and documented.

Conversion to `number` happens only inside formatters, at the moment of display.

## Consequences

**Easier.** Exact equality assertions become possible, so the property tests can be strict.
Totals reconcile with statements down to the cent. Rounding stops being emergent behaviour
scattered across expressions and becomes one documented decision — which matters because banks
differ here, and the rule has to be configurable to match a real loan.

**Harder.** `bigint` does not interoperate with `number`, so every boundary needs an explicit
conversion: chart libraries, form inputs, and `Intl.NumberFormat` all want numbers. `bigint`
also cannot be `JSON.stringify`'d, so the export format must serialise it deliberately — which
is arguably a feature, since it forces the persisted representation to be explicit and
versioned.

There is a mixed-type footgun: `1n + 1` throws at runtime rather than failing at compile time
in every case. The boundary check and the `Money` module's opaque type keep this contained, and
the arithmetic is small and centrally tested.

## Alternatives considered

**Plain `number` with rounding at the end.** The default, and wrong for the reason above: the
error accumulates through the compounding chain, so rounding at the end does not recover the
lost precision.

**A decimal library (decimal.js, big.js, dinero.js).** Correct, and genuinely tempting. Rejected
because `domain/` has a zero-dependency rule (ADR 0001) that is worth more than the convenience
here — the arithmetic this app needs is addition, subtraction, and multiplication by a rate,
which is perhaps eighty lines. A dependency would also be a supply-chain surface in the one
layer we most want to be able to audit by reading it.

**Store cents as `number`.** Integers below 2^53 are exact in IEEE-754, so this would in fact be
correct for realistic loan sizes. Rejected because nothing in the type system stops a stray
`* 1.05` or `/ 12` from silently reintroducing a fraction, and the resulting non-integer would
flow onward looking exactly like a valid amount. `bigint` makes that a runtime error at the
point of the mistake rather than a wrong number in a total.
