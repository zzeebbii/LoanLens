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

Requires Node 24 or newer.

```bash
npm install
npm run dev
```

With Docker instead, if you would rather not install Node:

```bash
docker compose up        # production build behind nginx, on :8080
docker compose up dev    # Vite dev server with hot reload, on :5173
```

## Development

```bash
npm run check          # everything CI runs, in the same order
npm run test:watch     # TDD loop
npm run refresh-rates  # pull the latest EURIBOR from the ECB into the bundled snapshot
```

`npm run check` is the gate: formatting, lint, types, module boundaries, i18n consistency,
the rate snapshot, tests with coverage, and the build. CI runs exactly this.

Read [`AGENTS.md`](./AGENTS.md) before contributing — it covers the handful of rules this
codebase does not bend on, and the reasons behind them.

## Deployment

Pushing to `main` runs the full gate and publishes to GitHub Pages. The build is prefixed
with the Pages path, and `index.html` is copied to `404.html` so a refresh on a deep link
reaches the client-side router — Pages has no rewrite rules.

A scheduled workflow refreshes the bundled EURIBOR snapshot on the 3rd of each month, after
the ECB has published the previous month's average. It commits only when the observations
actually changed, and validates the file before committing it.

## Documentation

- [Architecture](./docs/architecture.md) — layers, boundaries, and why they are where they are
- [Domain model](./docs/domain-model.md) — the engine, and the reasoning behind the parts that are easy to get wrong
- [Rate providers](./docs/rate-providers.md) — the interface, and how to plug in your own source
- [Architecture decisions](./docs/adr/) — the reasoning behind the load-bearing choices

## Data source

Interest rates come from the [ECB Data Portal](https://data.ecb.europa.eu/), series
`FM.M.U2.EUR.RT.MM.EURIBOR{1M,3M,6M,1Y}D_.HSTA`, with monthly observations back to January 1999. Rates are provided to the ECB by Refinitiv.

LoanLens is not affiliated with the ECB, and is not financial advice. Check anything that
matters against your lender's own figures.

## License

[MIT](./LICENSE)
