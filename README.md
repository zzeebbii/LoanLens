# LoanLens

Insights, reports and charts for EURIBOR-linked home loans.

Bank portals tell you what you owe this month. LoanLens tells you what the loan has actually
cost you so far, what the rest of it will cost, and what would change if you paid a bit more
each month.

- **Reconstructs your history** from real EURIBOR fixings — see what each past year actually
  cost as rates moved, not an idealised projection.
- **Projects the full schedule** to the final payment, with the capital / interest / fees split
  for every month.
- **Models extra payments** and shows both outcomes side by side: shortening the term versus
  lowering the monthly payment, against your baseline.
- **Charts everything** — where your money goes, when the capital/interest split flips, what a
  rate spike would do, and when extra payments break even.

## Privacy

There is no backend. Your loan details are stored in your own browser and never sent anywhere.
The app makes exactly one outbound request — to the European Central Bank's public data API,
asking for an interest-rate series. That request contains nothing about you or your loan.

Data moves between devices only through an export file you create yourself.

## Status

Early development. See [`CHANGELOG.md`](./CHANGELOG.md) for what exists so far.

## Running locally

Requires Node 22 or newer.

```bash
npm install
npm run dev
```

With Docker:

```bash
docker compose up
```

## Development

```bash
npm run check        # everything CI runs: format, lint, types, boundaries, i18n, tests, build
npm run test:watch   # TDD loop
```

Read [`AGENTS.md`](./AGENTS.md) before contributing — it covers the handful of rules this
codebase does not bend on, and the reasons behind them.

## Documentation

- [Architecture](./docs/architecture.md) — layers, boundaries, and why they are where they are
- [Architecture decisions](./docs/adr/) — the reasoning behind the load-bearing choices

## Data source

Interest rates come from the [ECB Data Portal](https://data.ecb.europa.eu/), series
`FM.M.U2.EUR.RT.MM.EURIBOR{1M,3M,6M,1Y}D_.HSTA`, with monthly observations back to January 1999. Rates are provided to the ECB by Refinitiv.

LoanLens is not affiliated with the ECB, and is not financial advice. Check anything that
matters against your lender's own figures.

## License

[MIT](./LICENSE)
