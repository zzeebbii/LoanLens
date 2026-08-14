# Rate providers

LoanLens does not hardcode where interest rates come from. Anything that can answer "what
was the reference rate in this month?" can drive the engine.

This document is the contract for implementing your own.

## Why there is an interface here

The engine never fetches anything. It receives rates as a plain function — see
[ADR 0001](./adr/0001-pure-domain-engine-with-injected-rates.md) — which means the source
is genuinely swappable rather than swappable-in-principle. `domain/` cannot tell the
difference between EURIBOR from the ECB, a curve typed in by hand, and a series pulled
from your own bank's API.

## The interface

```ts
interface RateProvider {
  readonly id: string // referenced by ReferenceIndex.providerId
  readonly labelKey: string // i18n key, never a literal
  readonly supportedTenors: readonly Tenor[]
  readonly earliestPeriod: YearMonth // bounds the UI's date pickers
  readonly requiresNetwork: boolean // drives the privacy note
  getSeries(request: RateSeriesRequest): Promise<RateSeries>
}
```

Defined in [`src/rates/types.ts`](../src/rates/types.ts).

```ts
interface RateSeriesRequest {
  readonly tenor: Tenor // '1M' | '3M' | '6M' | '12M'
  readonly from: YearMonth // 'YYYY-MM'
  readonly to: YearMonth
  readonly signal?: AbortSignal
}

interface RateSeries {
  readonly providerId: string
  readonly tenor: Tenor
  readonly points: readonly RatePoint[] // ascending, no duplicates
  readonly retrievedAt: string | null // ISO 8601, or null if not fetched
}

interface RatePoint {
  readonly period: YearMonth
  readonly rate: number // a FRACTION: 2.855% is 0.02855
}
```

### Rules a provider must follow

**`rate` is a fraction, not a percentage.** 2.855% is `0.02855`. Getting this wrong by a
factor of 100 produces a schedule that looks superficially plausible and is wildly wrong,
so convert at the boundary and nowhere else.

**Points must be ascending by period, with no duplicate periods.** Order is load-bearing:
`rateAt` walks the series and stops at the first period past the one it wants. Run your
points through `normalisePoints` from [`src/rates/series.ts`](../src/rates/series.ts) and
you get this for free — it also keeps the _last_ value for a duplicated period, which is
what you want when a provisional fixing is later restated.

**Gaps are fine.** A missing month is carried forward by `rateAt`. That is not leniency —
it is how a reference rate behaves: fixings are published monthly and a loan resetting
annually reads one in twelve, so "the rate for October" means "the most recent fixing as of
October".

**Never invent a value to fill a gap.** Return only what you actually have. Extending past
the published data is a _user's assumption_, handled explicitly in
[`src/rates/forecast.ts`](../src/rates/forecast.ts) and labelled as such in the UI.

**Throw `RateProviderError`, not a bare `Error`.** It carries the provider id, so the
message tells the user which source failed. Pass the underlying failure as `cause`.

**An empty result is an error, not an absence.** A successful request that matched nothing
means the series key or the range is wrong. Returning an empty series defers the failure
until the engine raises a `MissingRateError` in some unrelated month, which is much harder
to diagnose.

**`labelKey` is an i18n key.** Provider names appear in the UI, and no user-facing string
in this app is hardcoded. Use the `rates:provider.*` namespace.

**`requiresNetwork` must be honest.** It drives the privacy note that tells a user which
sources leave their device. Do not set it to `false` because your requests are "only
metadata".

**Take dependencies as options.** Accept `fetch` as an injected option rather than reaching
for the global. It is what makes a provider testable without a network, and it lets the app
wrap your provider in caching or retry without you knowing.

## Worked example

```ts
import type { RateProvider, RateSeries, RateSeriesRequest } from '@/rates/types'

import { parseYearMonth, yearMonth } from '@/domain/dates'
import { normalisePoints, slice } from '@/rates/series'
import { RateProviderError } from '@/rates/types'

export function createMyBankProvider(
  options: { fetch?: typeof globalThis.fetch } = {},
): RateProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch

  return {
    id: 'my-bank',
    labelKey: 'rates:provider.myBank.label',
    supportedTenors: ['3M', '12M'],
    earliestPeriod: yearMonth(2010, 1),
    requiresNetwork: true,

    async getSeries({ tenor, from, to, signal }: RateSeriesRequest): Promise<RateSeries> {
      let response: Response
      try {
        response = await fetchImpl(`https://example.test/rates/${tenor}`, { signal })
      } catch (cause) {
        throw new RateProviderError('my-bank', 'Could not reach the rate service.', { cause })
      }

      if (!response.ok) {
        throw new RateProviderError('my-bank', `Service returned ${response.status}.`)
      }

      const payload = (await response.json()) as { month: string; percent: number }[]

      const points = normalisePoints(
        payload.flatMap((entry) => {
          const period = parseYearMonth(entry.month)
          // Skip what you cannot parse rather than guessing at it.
          return period === null ? [] : [{ period, rate: entry.percent / 100 }]
        }),
      )

      if (points.length === 0) {
        throw new RateProviderError('my-bank', `No ${tenor} observations for ${from}..${to}.`)
      }

      return {
        providerId: 'my-bank',
        tenor,
        points,
        retrievedAt: new Date().toISOString(),
      }
    },
  }
}
```

Register it, and any loan naming `my-bank` resolves through it:

```ts
import { createDefaultRegistry } from '@/rates'

const registry = createDefaultRegistry().register(createMyBankProvider())
```

Registering under an existing id replaces that provider, which is how you override a
built-in source with your own.

## The providers that ship

| Provider         | Id         | Network | Notes                                                                           |
| ---------------- | ---------- | ------- | ------------------------------------------------------------------------------- |
| ECB Data Portal  | `ecb`      | yes     | The default. Monthly EURIBOR 1M/3M/6M/12M back to 1999-01.                      |
| Bundled snapshot | `snapshot` | no      | A JSON file committed to the repo, refreshed on a schedule.                     |
| Manual           | `manual`   | no      | Fixings the user typed in. Constructed at the point of use, not pre-registered. |

### ECB Data Portal

```
GET https://data-api.ecb.europa.eu/service/data/FM/{key}?format=csvdata&startPeriod=…&endPeriod=…
```

| Tenor | Series key                        |
| ----- | --------------------------------- |
| 1M    | `M.U2.EUR.RT.MM.EURIBOR1MD_.HSTA` |
| 3M    | `M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA` |
| 6M    | `M.U2.EUR.RT.MM.EURIBOR6MD_.HSTA` |
| 12M   | `M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA` |

Two things about this API are worth knowing before you touch the parser:

**The 12-month series is `EURIBOR1YD_`, not `EURIBOR12MD_`.** Extrapolating the pattern
from the shorter tenors gives a key that returns HTTP 200 with an empty body — so the
mistake looks like missing data rather than a bad request.

**Columns are located by header name, never by position.** The response carries around
forty columns of metadata whose layout is not part of any contract we control, and
`TITLE`/`TITLE_COMPL` are quoted free text _containing commas_. Splitting a record on
commas mangles every row; an index that silently shifted would read a different column and
report plausible nonsense. `src/rates/testing/ecb-response.ts` holds a verbatim captured
response so the parser is tested against the real thing.

`OBS_VALUE` is a percentage and is divided by 100 on the way in.

### Bundled snapshot

Committed at `public/data/euribor.json` and refreshed by
[`scripts/refresh-rates.mjs`](../scripts/refresh-rates.mjs). It earns its place three ways:
a fast first paint with no round trip to Frankfurt, a working app when the ECB is
unreachable, and offline use after first load.

Refresh it by hand with:

```bash
npm run refresh-rates
```

The script writes nothing unless the observations actually changed, so a scheduled run does
not produce a commit a month just to restamp `retrievedAt`. It also writes nothing if any
tenor fails, because a snapshot missing a series half-works: some loans would fall back to
the ECB and silently disagree with the others.

`npm run check:snapshot` validates the committed file independently of the runtime schema —
ordering, gaps, plausible ranges, and coverage. Two checks on unattended output is
deliberate.

## Forecasting past the data

The engine will not invent a rate for a future month; it throws `MissingRateError` naming
the period. Extending a series is an explicit, named assumption:

| Assumption  | Behaviour                                                             |
| ----------- | --------------------------------------------------------------------- |
| `HOLD_LAST` | The last published fixing continues. The default.                     |
| `SHOCK`     | Last fixing plus a shift in basis points. Drives the sensitivity fan. |
| `FIXED`     | A flat rate the user names.                                           |
| `CURVE`     | An explicit path; holds its last point beyond the end.                |

`extend` never rewrites a published fixing — a forecast only ever appends to the tail — so
a reconstructed history stays factual even while the same series projects forward.
