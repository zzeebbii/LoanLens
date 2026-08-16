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
- Exact monetary arithmetic in `bigint` minor units, with explicit rounding modes and a
  cent-conserving `allocate`.
- Calendar and day-count module supporting `MONTHLY_NOMINAL`, `ACT/360`, `ACT/365`,
  `30E/360` and `30/360` bond basis.
- Annuity amortization engine: `replay()` produces the full payment schedule with the
  capital, interest, capitalised-interest and fee split for every month, recalculating the
  instalment on rate resets and holding the payoff date.
- Floating-rate support for EURIBOR 1M/3M/6M/12M with margin, reference floor applied
  before the margin, configurable reset cadence and rate rounding.
- Interest rate caps: a ceiling on the reference rate for a fixed term, priced as a premium
  in basis points, as banks sell them. The ceiling applies to the reference before the margin
  is added, and the floor wins if the two ever contradict each other. Available both as a term
  of an existing loan and as a `RATE_CAP` scenario event, so an offer can be evaluated before
  it is accepted.
- Cap verdict card: interest avoided and premium paid shown side by side rather than netted,
  because a cap that saved 9,000 and cost 7,000 is a different bargain from one that saved
  2,000 for nothing. The comparison replays the loan three times to separate the ceiling's
  effect from the premium's, so a cap that never binds reports exactly zero interest avoided.
- Cap ceiling drawn on the rate history chart, dashed and spanning only the months it covers.
  The reference series plots the raw published fixing, so the gap above the ceiling is what
  the cap bought.
- Scenario events: one-off and recurring overpayments (shortening the term or lowering the
  payment), payment holidays with paid or capitalised interest, rate overrides, and balance
  corrections that re-anchor the schedule to a real statement.
- Analytics: whole-loan totals, yearly rollups, progress to date, scenario comparison,
  cash-flow break-even and cumulative running totals.
- Reference schedule verified independently against Python's `decimal`, plus property-based
  invariant tests covering exact principal repayment, monotonic balance and per-row
  reconciliation.
- `docs/domain-model.md` documenting the engine and the reasoning behind it.
- Pluggable rate providers behind a `RateProvider` interface, with a registry so a
  user-supplied source resolves for any loan that names it.
- ECB Data Portal provider covering EURIBOR 1M/3M/6M/12M back to January 1999, parsed from
  SDMX CSV with columns located by header name.
- Bundled rate snapshot committed at `public/data/euribor.json` — 1,324 real observations —
  giving a fast first paint, an offline mode and a fallback if the ECB is unreachable.
- Manual provider for fixings the user enters themselves.
- Forecast assumptions for periods past the published data (hold last, basis-point shock,
  fixed rate, explicit curve) plus the shocked variants that drive the sensitivity fan.
  Published fixings are never overwritten by a projection.
- `npm run refresh-rates` to refresh the snapshot, and `npm run check:snapshot` to validate
  the committed file independently of the runtime schema.
- `docs/rate-providers.md` documenting the interface and how to implement one.
- Local-first persistence: `LoanRepository` interface with an IndexedDB implementation via
  Dexie, an in-memory implementation used both in tests and as the fallback when storage is
  unavailable, and automatic selection between them.
- A stored representation kept separate from domain types, with money as decimal minor-unit
  strings so records survive JSON and structured cloning, and validation on read so one
  corrupt record is a named error rather than a malformed loan.
- Versioned, Zod-validated export and import. Merge or replace on import, a refusal to read
  a format newer than the running build, and rejection of a backup whose scenarios reference
  loans it does not contain.
- i18n with i18next: eight namespaces, keys typed from the English resources so a typo is a
  build error, and locale parity enforced in CI.
- Locale-aware formatting through `Intl` throughout. Money reaches the screen as an exact
  decimal string rather than a float, so nothing is lost at the last step.
- Application shell with type-safe routing, theme switching and a skip link, on Tailwind 4 and
  hand-owned shadcn/ui primitives.
- Portfolio view listing every loan with what is still owed, the current instalment and rate,
  the payoff date and repayment progress; per-currency totals once there is more than one loan.
- Loan create and edit form. Day count, rate rounding and the reference floor are first-class
  and explained rather than hidden, because they are what decide whether the model agrees with
  a real statement.
- Payment schedule: virtualised table over the full term with per-row flags for rate resets,
  overpayments and corrections, filters for past and remaining, and a yearly rollup.
- Scenarios: a no-setup comparison of shortening the term against lowering the payment for the
  same overpayment, plus saved scenarios built from overpayments and payment holidays.
- Rate panel showing the source, margin, floor and every reset, with a rate-sensitivity table
  computed by replaying the loan rather than by scaling the baseline.
- Settings with per-loan defaults, the forecast assumption, and export, import and delete.
- Component tests driving the real provider stack — the form is exercised by typing into
  labelled fields and asserting on the `Loan` that comes out.
- Charts, on a palette validated for colour-vision deficiency and surface contrast in both
  light and dark rather than chosen by eye (see
  [ADR 0004](./docs/adr/0004-validated-chart-palette.md)):
  - Headline figures as stat tiles with sparklines.
  - Capital versus interest per instalment over the term, with the crossover month called out.
  - Remaining balance over the life of the loan.
  - Cost per calendar year, split into interest, capital and fees.
  - Lifetime cost as one labelled bar plus the ratio as a hero figure.
  - The reference rate against the rate actually charged, with reset months marked.
  - A single instalment broken into its parts, for any month worth looking at.
  - Total interest at five different rates, coloured by an ordinal ramp.
  - Interest month by month as a heatmap, where a rate reset shows as a whole row shifting.
  - Every chart carries a legend, a keyboard-reachable table view and an accessible name.
- The charts are loaded on demand, so a first visit does not pay for the charting library.
- A date field combining a typed input with a calendar popover — typing reaches a drawdown
  date years back far faster than clicking, and the calendar is better for a nearby date.
- A month field built from a month and a year select, for the fields that want a month rather
  than a day. Picking a month by clicking a day and silently discarding the day is the kind
  of interface that makes people distrust the figures.
- The calendar grid is loaded when its popover first opens, so it costs nothing on a visit
  that never opens it.
- GitHub Pages deployment, running the full check gate before publishing, with the Pages base
  path applied and a `404.html` fallback so deep links survive a refresh.
- Scheduled monthly refresh of the bundled EURIBOR snapshot, which commits only when the
  observations changed and validates the file before committing it.
- Multi-stage Dockerfile serving the same static output behind nginx, with a tight
  content-security policy allowing exactly one outbound host, plus a Compose file offering
  either the production build or a hot-reloading dev server.
- Dependabot for npm, GitHub Actions and Docker, grouped so a month of updates is a handful of
  reviewable pull requests rather than forty. `oxfmt` is excluded: it is pre-1.0 and a bump
  reformats the codebase, which belongs in its own commit.
- Edit and delete on each loan card, so correcting a margin does not cost a navigation each
  way. Both name the loan they act on, as does the confirmation, because in a list of cards a
  row of buttons all called "Delete" says nothing about which loan is about to go.

### Fixed

- Restored the pointer cursor on interactive controls. Tailwind 4's preflight dropped the
  `cursor: pointer` browsers apply to buttons, so nothing in the app looked clickable on
  hover — most visibly the loan page's tabs, which have no other affordance saying they are
  interactive. Fixed once at the base layer rather than per component.
- Instalment overrides (`INSTALMENT_OVERRIDE`), for taking the payment from a statement rather
  than deriving it. A "variable annuity" is struck once — at signing or at a reset — and then
  held, so the payment on a statement routinely reflects a rate that no longer applies and
  cannot be recovered from the rate that does. A real case: a contract fixing the annuity at
  897.42 when the rate was 3.63%, drawn down two months later at 3.976%, where the lender
  charged 901.37 rather than the 918.61 that rate and term imply. Nothing is mis-entered; the
  payment is an input, not an output. Left derived, the difference lands entirely in capital —
  17 euro a month, a thousand euro of phantom repayment inside four years.
- The first instalment silently understated its interest under the default day count. The gap
  between drawdown and the first payment is the one period in a schedule that is almost never
  a whole month, and `MONTHLY_NOMINAL` counts whole months and discards the remainder — right
  for every other period, wrong for this one. A real case: drawn down 27 September against a
  first payment on 20 November is 54 days, charged as 30, dropping some €330 of interest on a
  €125,000 balance. The engine was accruing from the drawdown date correctly; the convention
  was throwing the days away. The form now says how many days would go uncharged, and a new
  loan defaults to a drawdown on its payment day so a blank form is self-consistent.
- Header navigation looked like a button only on its own page. The links were ghost buttons,
  so they had no visible edge until hovered, and picked up a filled background when their
  route was active — the same fill used for hover. Both now wear the same outline everywhere,
  and the current page is marked with `aria-current` as well as a background.
- Toggle labels sat about 2.5px below their switch whenever help text made the row tall
  enough to notice. An inline `<label>` in an unstyled block takes that block's line height —
  1.5 at the root font size, so 24px — rather than its own 20px, and its text is centred in
  the taller box while the switch is pinned to the top. The toggle rows now come from one
  `SwitchField` component whose label is a block of matching height.
- Replaced the native `type="date"` and `type="month"` inputs. They worked, but rendered the
  browser's own widget, which ignores the app's styling entirely — and `type="month"` is
  unimplemented in some browsers, where it degrades to a bare text box.
- The Docker image did not start. Dropping to the `nginx` user left the runtime paths nginx
  writes — its temp caches and pid file — owned by root, so the master exited immediately
  with a permission error on `/var/cache/nginx/client_temp`.
- The container served none of its security headers. nginx inherits `add_header` from an
  outer block only while the inner block sets no header of its own, so every location that
  set a `Cache-Control` silently discarded the content-security policy, `nosniff` and the
  referrer policy declared at server level. That was every path the app is served on,
  the HTML document included. The headers now live in a snippet each location includes.
- Assets no longer return two `Cache-Control` headers, one from `expires` and one added
  alongside it.
- The container listens on IPv6 explicitly. The base image's entrypoint script tries to add
  this by rewriting the config at boot, which cannot work once the config is root-owned and
  nginx has dropped privileges.

### Changed

- Upgraded to TypeScript 7, `@types/node` 26, `@vitejs/plugin-react` 6 and `lucide-react` 1.
  TypeScript 7 removed `baseUrl`, so path mappings are now written relative to `tsconfig.json`.
- Node baseline raised to 24; CI runs on 24 and 26.
- `npm run check` now runs the coverage-gated test command, matching CI. Previously it ran
  the plain test command, so coverage could fail in CI while the local check passed.

[Unreleased]: https://github.com/visma-zohaib-aslam/LoanLens/commits/main
