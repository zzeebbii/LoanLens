# Domain model

The financial engine, and the reasoning behind the parts that are easy to get wrong.

> If you change anything here, update this document in the same PR. A wrong number in
> this app is _believed_, which is what makes the engine different from the rest of it.

## The one function

```ts
replay(input: {
  loan: Loan
  referenceRateAt: (period: YearMonth, index: ReferenceIndex) => number | null
  events?: LoanEvent[]
  maxPeriods?: number
}): PaymentRow[]
```

Everything the app shows — tables, totals, all eleven charts, every scenario comparison —
is derived from the `PaymentRow[]` this returns. `src/domain/analytics.ts` folds those rows
into totals, yearly rollups, progress-to-date and scenario comparisons; it never
recalculates anything.

A **scenario is not a mode**. It is the same `replay` with a different `events` array, and a
comparison is two result sets diffed. That is what makes the comparisons trustworthy: both
sides went through identical code.

Rates arrive as an **injected function**, so the engine is synchronous, deterministic, and
has no idea the ECB exists. See
[ADR 0001](./adr/0001-pure-domain-engine-with-injected-rates.md).

## Money

Integer minor units in a `bigint`, always. See
[ADR 0002](./adr/0002-money-as-bigint-minor-units.md) for why, and `src/domain/money.ts`
for the operations. Rates stay `number`; `multiplyByRate` is the only place the two meet,
and it scales the rate to an integer so only the final division rounds.

## Annuity repayment

```
P = L · i / (1 − (1 + i)^−n)
```

`L` is the balance, `i` the periodic rate, `n` the periods remaining.

**The denominator is computed as `−expm1(−n · log1p(i))`, not literally.** The two are
algebraically identical and numerically are not. At `i = 1.3e-15` over 121 periods,
`(1 + i)^-n` is `0.999999999999839`; subtracting that from 1 destroys all but about three
significant digits. That produced an instalment roughly half the correct size and a loan
still unpaid at twice its term. A property test found it; `log1p`/`expm1` keep full
precision near zero.

At exactly zero — or at a rate small enough that `1 + i === 1` — the formula degenerates,
and the instalment is the balance spread evenly, rounded **up** so the loan never ends on a
balloon payment.

### Sizing versus accrual

These use _different_ rates, deliberately:

- The instalment is **sized** using a nominal periodic rate, `annualRate / 12`.
- Each period's interest is **accrued** using the loan's day-count convention.

A lender charging interest on ACT/360 still sizes the annuity off a nominal monthly rate.
If it sized off the day-count factor instead, the instalment would change with the length
of every month and an annuity loan would not have a level payment at all.

### When the instalment is recalculated

Only when the basis genuinely changes:

| Trigger                          | Why                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| First period                     | Nothing to carry forward.                                                                                                       |
| Rate reset                       | New rate over the balance then outstanding and the periods still remaining — so the payment moves and the payoff date does not. |
| Payment holiday ends             | The balance is higher and fewer periods remain; the old instalment no longer amortises. Lenders resize here too.                |
| Overpayment with `LOWER_PAYMENT` | That is what the effect means.                                                                                                  |
| Balance correction               | The balance it was sized against is no longer the balance.                                                                      |

`remainingPeriods` is always measured against the **original** term, `termMonths − elapsed`.
That is what keeps a rate rise from moving the payoff date. An overpayment made to shorten
the term does not enter the calculation at all — the instalment holds and the loop simply
ends earlier.

## Rate resolution

For a floating loan, in order:

1. A `RATE_OVERRIDE` covering this period wins outright, and lapses the moment its range
   ends rather than sticking until the next reset.
2. Otherwise, on the first period or a **reset period**, read the reference fixing.
3. Apply `referenceFloor` to the **reference**, then add the margin.
4. Apply `rateRounding`, if the agreement specifies one.
5. Between resets, hold.

**The floor goes on the reference, before the margin.** This is the distinction that
decided whether 2015–2021 borrowers benefited from negative EURIBOR: with the reference
floored at 0, a −0.5% fixing plus a 55bp margin is 0.55%, not 0.05%. Flooring the total
instead would understate what those borrowers actually paid.

Reset periods fall on a fixed cadence from `firstResetPeriod` — every twelfth month for a
12M-linked loan — **not** on the payment anniversary. Real agreements make this
distinction and borrowers routinely conflate them.

If a fixing is needed and the resolver returns `null`, `replay` throws `MissingRateError`
naming the period. It will not invent a rate: choosing what happens beyond the published
data (hold flat, follow a curve, stress upward) is a modelling assumption the user should
see and control.

## Day-count conventions

Over 25 years the choice moves the total interest by thousands, and lenders differ. It is
per-loan configuration; the right value is whatever the loan agreement says.

| Convention        | Period factor      | Notes                                                                                                                                  |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `MONTHLY_NOMINAL` | `1/12`             | Textbook annuity assumption; what most public calculators use. **Default.**                                                            |
| `ACT_360`         | `actualDays / 360` | Common in Nordic and continental lending. Charges ~1.4% more interest per year than nominal, because 365 real days are divided by 360. |
| `ACT_365`         | `actualDays / 365` |                                                                                                                                        |
| `THIRTY_360_EU`   | 30E/360            | Both day-of-month values capped at 30.                                                                                                 |
| `THIRTY_360_US`   | 30/360 bond basis  | End date pulled back to 30 only when the start was already at 30 or 31.                                                                |

`MONTHLY_NOMINAL` counts **whole months**, and treats a month ending on its last day as
whole. Without that, a loan paying on the 31st has its February payment clamped to the
28th, the day comparison scores 31 → 28 as a partial month, and a twelfth of a year of
interest silently disappears from every short month. A regression test pins this.

Interest for the first period accrues from **drawdown** to the first payment date, which is
usually a partial period and often longer than a month.

## Events

| Event                | Effect                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| `EXTRA_PAYMENT`      | One-off lump sum in a given period.                                      |
| `RECURRING_EXTRA`    | Standing overpayment; `until: null` means for the rest of the loan.      |
| `PAYMENT_HOLIDAY`    | Amortisation suspended. Interest is either paid or capitalised.          |
| `RATE_OVERRIDE`      | Forces the applied rate. Covers negotiated rates and stress scenarios.   |
| `BALANCE_CORRECTION` | Pins the balance to a real statement figure and recalculates from there. |

`BALANCE_CORRECTION` exists because the model _will_ drift from a lender's own numbers
wherever a rounding or day-count rule is not exactly reproduced. Rather than let that
compound silently for twenty years, the user can anchor the schedule to a known-good
balance.

## Extra payments: the comparison the app exists for

- **`SHORTEN_TERM`** — instalment holds, loan finishes sooner. Saves the most interest,
  because every overpaid euro removes the interest it would have accrued for the _entire_
  remaining term.
- **`LOWER_PAYMENT`** — payoff date holds, instalment is resized downward. Saves less
  interest, frees monthly cash.

### Break-even is about cash flow, not interest

The intuitive metric — "when does interest saved overtake what I put in?" — **never
crosses**, and the reason matters: an overpayment is not a cost. It retires principal owed
anyway, so it is money moved earlier in time, not money lost. Measuring it as a cost makes
overpaying look like it never pays back, which is simply wrong.

`breakEven` therefore compares **cumulative total outlay**. The overpayer runs ahead of the
baseline while paying more each month, then the baseline keeps paying after the overpayer's
loan is settled. Where cumulative spend equalises is the honest answer to "when am I better
off?", and `peakAdditionalOutlay` says how far out of pocket they got on the way.

`interestSavedPerUnitOverpaid` is reported alongside and is normally well below 1. That is
not a disappointing result — it is the interest avoided per euro of principal brought
forward.

## Termination

`replay` runs until the balance is exactly zero, which may be **one period past the nominal
term**. That is not a defect: rounding each instalment to the cent leaves a small residue,
and lenders settle it with a final adjusting payment rather than by nudging every earlier
instalment. In the reference schedule below, that final payment is €0.49.

`maxPeriods` (default `termMonths + 120`) is a backstop. Exceeding it throws
`NonAmortizingLoanError` rather than looping.

## The reference schedule

Produced with Python's `decimal` module **before** the TypeScript existed, and asserted in
`schedule.test.ts`. If the engine ever disagrees with these, the engine is what changed.

> €250,000 · 3.4% nominal annual · 300 monthly instalments · `MONTHLY_NOMINAL` ·
> interest and instalment rounded half-up to the cent

|                                |                                                        |
| ------------------------------ | ------------------------------------------------------ |
| Instalment                     | **€1,238.19**                                          |
| Month 1                        | interest €708.33, capital €529.86, closing €249,470.14 |
| Month 2                        | interest €706.83, capital €531.36, closing €248,938.78 |
| Capital first exceeds interest | **month 57** of 300                                    |
| Periods                        | **301** (final adjusting payment €0.49)                |
| Total interest                 | **€121,457.49**                                        |
| Total paid                     | **€371,457.49**                                        |

## Invariants

Asserted with `fast-check` across hundreds of generated loans, as exact equalities —
possible only because money is an exact integer type:

- `Σ capital == principal`, exactly
- the balance is monotonically non-increasing, and never negative
- each row's closing balance equals the next row's opening balance
- `closing == opening + capitalisedInterest − capital − extraPayment`, per row
- `totalPaid == interest + capital + extraPayment + fees`, per row
- the final closing balance is exactly zero
- capital and interest are never negative, however violently the rate moves

## Open questions

Two values cannot be settled from first principles — they depend on the actual loan
agreement, and the way to resolve both is to compare a reconstructed history against real
statements:

1. **Day-count convention.** Default is `MONTHLY_NOMINAL`; many Nordic lenders use
   `ACT_360`.
2. **Reference floor.** Whether the agreement floors EURIBOR at 0% materially changes the
   reconstructed 2021–2022 history.
