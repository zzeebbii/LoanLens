# ADR 0004: A validated three-slot chart palette

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

This app is mostly charts, and the charts are about money. Two failure modes matter more
here than in a typical dashboard:

1. **A reader who cannot tell two series apart draws a wrong conclusion** about their own
   finances. Roughly 8% of men have some form of red-green colour vision deficiency, and a
   palette that looks fine to the author can collapse to two identical greys for them.
2. **Colour is the channel most often chosen by eye** and least often checked. "These look
   different enough" is not a measurement.

The first Phase 1 pass at this was exactly that mistake: six `oklch()` values picked
because they looked distinct, with a comment admitting they were placeholders.

## Decision

The chart palette is the **first three slots of a palette validated with a script**, not a
set of colours chosen by eye. Every claim below was produced by running
`scripts/validate_palette.js` from the `dataviz` skill, in both modes:

| Check                                        | Light       | Dark     |
| -------------------------------------------- | ----------- | -------- |
| Lightness band                               | pass        | pass     |
| Chroma floor                                 | pass        | pass     |
| Worst adjacent CVD ΔE (target ≥ 8)           | **9.2**     | **9.4**  |
| Worst adjacent normal-vision ΔE (floor ≥ 15) | **27.6**    | **26.5** |
| Contrast vs surface (≥ 3:1)                  | one warning | pass     |

Slots: blue `#2a78d6`, orange `#eb6834`, aqua `#1baf7a` (light); `#3987e5`, `#d95926`,
`#199e70` (dark).

**Three slots, not more.** Three is the count that clears the _all-pairs_ gate rather than
only the adjacent one, and no chart here needs a fourth identity. Adding a fourth would put
yellow beside orange, which fails the all-pairs floors.

**Dark mode is a selected palette, not a derived one.** The dark values are the same three
hues re-stepped for the dark surface and validated against it. An automatic lighten of the
light values falls outside the dark lightness band.

**Ordered scales use an ordinal ramp, not the categorical palette.** The rate-shock
comparison (−100bp … +300bp) has a natural order, so one hue carries it, monotone in
lightness, validated with `--ordinal`. The interest heatmap uses the full sequential ramp.

Charts reference **domain roles** (`--chart-capital`, `--chart-interest`) rather than slots,
and always as `var(--…)` — never a hex in a component.

## Consequences

**Easier.** Colour stops being a matter of opinion: a proposed change is run through the
script and either passes or does not. The validator's findings live in a comment beside the
values, so a future reader knows what the constraints were rather than guessing. Referencing
variables means the whole validated set swaps at once between modes.

**Harder.** Three identities is a real constraint. It has already changed two chart designs
for the better — the lifetime split became one labelled bar plus a hero figure instead of a
two-slice donut, and the payment breakdown became a stacked bar instead of a waterfall — but
a future chart wanting four series has to be split or faceted rather than given a new hue.

**One accepted warning.** Aqua measures 2.74:1 on the light surface, below the 3:1 target.
The relief the guidance requires is in place and is enforced structurally rather than by
convention: `ChartFrame` renders a legend for any chart with two or more series and offers a
table view, and every part-to-whole chart directly labels its segments. Identity never rests
on that hue alone. If a future chart uses aqua without a legend or labels, that is a bug.

**What is still unverified.** The validator checks colour, not layout. Label collisions,
axis overflow and geometry need a real browser — jsdom has no layout, so the chart tests
assert the accessibility contract (legend present, table view reachable, region named) and
cannot assert that the picture looks right.

## Alternatives considered

**Keep the hand-picked `oklch()` values.** They were never measured. Two of the six sat
close enough in hue that a deuteranope would likely have read them as the same colour, and
nothing in the codebase would have revealed it.

**Generate hues programmatically to any series count.** Tempting for "just one more
series", and the documented failure: a generated hue is indistinguishable from an existing
slot under CVD and breaks every separation check.

**A single hue with varying lightness for everything.** Safe, and wrong for identity: it
double-encodes magnitude as hue on charts where the series are the subject, and makes
capital-versus-interest read as a value ramp rather than two different things.
