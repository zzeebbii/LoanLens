# ADR 0003: Static, local-first deployment with no backend

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

This app holds one of the more sensitive financial facts about a person: the size of their
mortgage, its rate, and their repayment capacity. It also needs live-ish market data (EURIBOR
fixings) to be useful, and it needs to be deployed somewhere.

The obvious architecture — a server that stores loans and proxies the rate API — would make
this app a database of other people's mortgages, with the operational and privacy obligations
that implies, in exchange for benefits (sync, sharing) that were not asked for.

The open question was whether a static site could actually reach the rate data. Browsers block
cross-origin requests unless the server opts in, and a CORS-less API would have forced a proxy,
and therefore a server.

**This was verified before committing to the approach.** The ECB Data Portal API returns
`access-control-allow-origin: *`:

```
$ curl -sD - -o /dev/null -H "Origin: https://example.github.io" \
    "https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA?lastNObservations=2"
HTTP/2 200
access-control-allow-origin: *
```

All four tenors (1M, 3M, 6M, 12M) resolve, with monthly observations back to 1999-01.

## Decision

LoanLens is a static single-page application deployed to GitHub Pages, with no backend of any
kind. Loan data is stored in IndexedDB on the user's device and moves between devices only via
an explicit JSON export the user initiates. The browser fetches EURIBOR directly from the ECB.

Storage sits behind a `LoanRepository` interface so the mechanism is swappable, but no remote
implementation is planned.

## Consequences

**Easier.** The privacy story is a fact about the architecture rather than a promise in a policy
document: there is no server, so there is nothing to breach, subpoena, or misconfigure. The
only outbound request asks for a public interest-rate series and carries no personal data.
Hosting is free and effectively maintenance-free. There is no auth, no session handling, no
database migration story, and no backend to keep patched.

**Harder.** There is no sync: a user with a laptop and a phone maintains two independent copies
unless they export and import. Clearing site data destroys everything, so export must be
prominent and easy rather than buried in settings. Nothing can run on a schedule on the user's
behalf.

The app is also exposed to the ECB API's availability and to it continuing to serve permissive
CORS headers. Both risks are mitigated by the `snapshot` provider — a rate file committed to the
repo by a scheduled workflow — which doubles as the fast path for first paint.

Client-side routing needs the `404.html` copy trick, because Pages has no rewrite rules.

## Alternatives considered

**A small backend for storage and sync.** Rejected as a poor trade: it would centralise exactly
the data we would rather never hold, in exchange for a convenience the user did not ask for.

**Static site plus a serverless function to proxy the rate API.** This would have been necessary
if the ECB blocked cross-origin requests. The `curl` check above showed it does not, so the
proxy would add an operational dependency for nothing.

**`localStorage` instead of IndexedDB.** Simpler API, but a ~5 MB string-only store. Full
payment schedules with per-row overrides across several loans and scenarios will exceed that,
and serialising everything to a single string on every write scales badly.
