/**
 * Chart colour roles.
 *
 * Every value is a `var(--…)` reference, never a hex. Two reasons:
 *
 *  - Light and dark are *selected* palettes, not derived ones. The dark steps were
 *    chosen and validated against the dark surface; an automatic lighten would fail
 *    the lightness band. Referencing the variable means the browser swaps the whole
 *    validated set at once.
 *  - A hex in a chart component is a colour that escaped review. The palette in
 *    `src/styles/index.css` carries the validator's findings in a comment beside the
 *    values; a copy elsewhere would drift from that record.
 *
 * The roles are named for what they *mean*, not for their slot, so a chart says
 * "capital" and gets the same colour everywhere.
 */
export const SERIES = {
  capital: 'var(--chart-capital)',
  interest: 'var(--chart-interest)',
  fees: 'var(--chart-fees)',
  /** Context, not a competing series. Deliberately grey. */
  baseline: 'var(--chart-baseline)',
  scenario: 'var(--chart-scenario)',
  alternative: 'var(--chart-alternative)',
} as const

export type SeriesRole = keyof typeof SERIES

/**
 * Ordinal ramp, lightest to darkest, for categories with a natural order — the rate
 * shocks. A categorical palette here would throw away the ordering that is the whole
 * point of the comparison.
 */
export const ORDINAL_RAMP = [
  'var(--ramp-1)',
  'var(--ramp-2)',
  'var(--ramp-3)',
  'var(--ramp-4)',
  'var(--ramp-5)',
] as const

/** Sequential ramp for continuous magnitude. Light means near zero. */
export const SEQUENTIAL_RAMP = [
  'var(--seq-100)',
  'var(--seq-200)',
  'var(--seq-300)',
  'var(--seq-400)',
  'var(--seq-500)',
  'var(--seq-600)',
  'var(--seq-700)',
] as const

export const CHROME = {
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  /** The colour of the 2px gap that separates touching marks, and of marker rings. */
  surface: 'var(--card)',
} as const

/** Fixed mark specs. Applied uniformly so every chart reads as one system. */
export const MARKS = {
  /** Lines are 2px with round joins. */
  lineWidth: 2,
  /** Markers are at least 8px across, so they are visible and hoverable. */
  dotRadius: 4,
  activeDotRadius: 5,
  /** A wash, never a saturated block. */
  areaOpacity: 0.12,
  /** Bars are capped rather than filling their band; the leftover is air. */
  maxBarWidth: 24,
  /** Surface-coloured separation between touching marks. */
  gap: 2,
  ringWidth: 2,
} as const

/**
 * Picks a step from a ramp for a value in `[0, 1]`.
 *
 * Clamped rather than wrapped: a value outside the range is a bug in the caller, and
 * wrapping would render the largest magnitude as the palest colour.
 */
export function rampStep(ramp: readonly string[], fraction: number): string {
  if (ramp.length === 0) throw new RangeError('Ramp must have at least one step.')
  const index = Math.round(Math.min(1, Math.max(0, fraction)) * (ramp.length - 1))
  return ramp[index] as string
}
