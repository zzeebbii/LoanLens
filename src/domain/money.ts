/**
 * Exact monetary arithmetic.
 *
 * Amounts are integer counts of minor units (cents) held in a `bigint`. A 30-year
 * loan is 360 dependent compounding steps; IEEE-754 error accumulates through that
 * chain in the direction of the operations, which is exactly the kind of drift that
 * turns "your model disagrees with the bank by €3" into an unfalsifiable argument.
 *
 * Integers also make the engine's real invariants assertable as equalities: the
 * capital portions sum to the principal *exactly*, and the final balance is
 * *exactly* zero. See docs/adr/0002-money-as-bigint-minor-units.md.
 *
 * Rates stay as `number` — they are ratios, not amounts. The one place a rate meets
 * an amount is `multiplyByRate`, and that is where the rounding decision lives.
 */

declare const moneyBrand: unique symbol

/** An exact monetary amount, in minor units. Construct with {@link money}. */
export type Money = bigint & { readonly [moneyBrand]: true }

/**
 * How to resolve an amount that falls between two minor units.
 *
 * - `HALF_UP`   — ties go away from zero. The common banking default.
 * - `HALF_EVEN` — ties go to the even neighbour ("banker's rounding"); unbiased
 *                 across many roundings, which some lenders prefer.
 * - `DOWN`      — always toward zero (truncate).
 * - `UP`        — always away from zero.
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP'

export const DEFAULT_ROUNDING: RoundingMode = 'HALF_UP'

/** Minor units per major unit. Fixed at 2: every currency this app targets is a euro-like decimal. */
const MINOR_UNITS_PER_MAJOR = 100n
const MINOR_UNIT_DECIMALS = 2

/**
 * Rates are scaled to integers before multiplication so the product itself is exact.
 * 1e12 keeps twelve decimal places of a rate — for a monthly rate around 0.0028 that
 * is roughly ten significant digits, i.e. sub-microcent error on any realistic balance.
 */
const RATE_SCALE = 1_000_000_000_000n
const RATE_SCALE_AS_NUMBER = 1e12

/** Rates beyond this are certainly a unit mix-up (a percent passed where a fraction was meant). */
const MAX_ABSOLUTE_RATE = 1000

export const ZERO = 0n as Money

/** Wraps integer minor units as {@link Money}. Throws if `cents` is not an integer. */
export function money(cents: bigint | number): Money {
  if (typeof cents === 'number') {
    if (!Number.isInteger(cents)) {
      throw new RangeError(
        `Money must be a whole number of minor units, received ${cents}. ` +
          'Use fromMajorUnits() or parseMoney() to convert a decimal amount.',
      )
    }
    return BigInt(cents) as Money
  }
  return cents as Money
}

/** The underlying integer minor units. */
export function toCents(amount: Money): bigint {
  return amount
}

/**
 * Converts a decimal major-unit amount (e.g. `812.44`) to {@link Money}.
 *
 * Goes through a float, so it is only safe for values a user could plausibly type.
 * Prefer {@link parseMoney} for text input, which never touches a float.
 */
export function fromMajorUnits(value: number): Money {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot convert ${value} to a monetary amount.`)
  }
  return money(BigInt(Math.round(value * Number(MINOR_UNITS_PER_MAJOR))))
}

/**
 * Converts to a decimal major-unit number, for formatters and chart libraries.
 *
 * This is the boundary where exactness ends. Call it as late as possible, and never
 * feed the result back into a calculation.
 */
export function toMajorUnits(amount: Money): number {
  return Number(amount) / Number(MINOR_UNITS_PER_MAJOR)
}

const DECIMAL_INPUT = /^([+-]?)(\d+)(?:[.,](\d+))?$/

/**
 * Parses a decimal string exactly, without float arithmetic.
 *
 * Accepts either separator, since euro-area locales write `812,44` and the app must
 * not reject what a user's own keyboard produces. Excess precision is rounded half-up:
 * `parseMoney('1.005')` is 101 cents, where `Math.round(1.005 * 100)` would give 100
 * because 1.005 is not representable as a double.
 *
 * @returns the amount, or `null` if the input is not a plain decimal number.
 */
export function parseMoney(input: string): Money | null {
  const match = DECIMAL_INPUT.exec(input.trim())
  if (!match) return null

  const [, sign = '', whole = '0', fraction = ''] = match

  // One extra digit of precision, so the discarded remainder can decide the rounding.
  const padded = fraction.padEnd(MINOR_UNIT_DECIMALS + 1, '0')
  const keptDigits = padded.slice(0, MINOR_UNIT_DECIMALS)
  const restDigits = padded.slice(MINOR_UNIT_DECIMALS)

  let cents = BigInt(whole) * MINOR_UNITS_PER_MAJOR + BigInt(keptDigits || '0')

  // Round half-up on the discarded tail.
  if (restDigits.length > 0 && BigInt(restDigits) * 2n >= 10n ** BigInt(restDigits.length)) {
    cents += 1n
  }

  return money(sign === '-' ? -cents : cents)
}

/**
 * Integer division with an explicit rounding rule, sign-symmetric.
 *
 * Rounding is applied to the magnitude and the sign reapplied afterwards, so `DOWN`
 * means "toward zero" and `UP` means "away from zero" for negatives too. Anything
 * else makes a refund round differently from a charge of the same size.
 */
function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero.')
  }

  const negative = numerator < 0n !== denominator < 0n
  const absoluteNumerator = numerator < 0n ? -numerator : numerator
  const absoluteDenominator = denominator < 0n ? -denominator : denominator

  const quotient = absoluteNumerator / absoluteDenominator
  const remainder = absoluteNumerator % absoluteDenominator

  if (remainder === 0n) {
    return negative ? -quotient : quotient
  }

  let rounded: bigint
  switch (mode) {
    case 'DOWN': {
      rounded = quotient
      break
    }
    case 'UP': {
      rounded = quotient + 1n
      break
    }
    case 'HALF_UP': {
      rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient
      break
    }
    case 'HALF_EVEN': {
      const doubled = remainder * 2n
      if (doubled > absoluteDenominator) rounded = quotient + 1n
      else if (doubled < absoluteDenominator) rounded = quotient
      else rounded = quotient % 2n === 0n ? quotient : quotient + 1n
      break
    }
  }

  return negative ? -rounded : rounded
}

export function add(a: Money, b: Money): Money {
  return (a + b) as Money
}

export function subtract(a: Money, b: Money): Money {
  return (a - b) as Money
}

export function negate(amount: Money): Money {
  return -amount as Money
}

export function abs(amount: Money): Money {
  return (amount < 0n ? -amount : amount) as Money
}

export function sum(amounts: Iterable<Money>): Money {
  let total = 0n
  for (const amount of amounts) total += amount
  return total as Money
}

/** Multiplies by a whole count, e.g. twelve monthly fees. */
export function multiplyByInteger(amount: Money, factor: number | bigint): Money {
  if (typeof factor === 'number' && !Number.isInteger(factor)) {
    throw new RangeError(
      `Expected a whole factor, received ${factor}. Use multiplyByRate() instead.`,
    )
  }
  return (amount * BigInt(factor)) as Money
}

/**
 * Multiplies by a rate — the one crossing point between exact amounts and float ratios.
 *
 * The rate is scaled to an integer first, so the multiplication is exact and only the
 * final division rounds. That keeps the error to at most half a minor unit per call,
 * rather than letting float error into the balance that feeds the next period.
 */
export function multiplyByRate(
  amount: Money,
  rate: number,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  if (!Number.isFinite(rate)) {
    throw new RangeError(`Rate must be a finite number, received ${rate}.`)
  }
  if (Math.abs(rate) > MAX_ABSOLUTE_RATE) {
    throw new RangeError(
      `Rate ${rate} is out of range. Rates are fractions, not percentages: 3.4% is 0.034.`,
    )
  }

  const scaledRate = BigInt(Math.round(rate * RATE_SCALE_AS_NUMBER))
  return money(divideRounded(amount * scaledRate, RATE_SCALE, mode))
}

export function divideByInteger(
  amount: Money,
  divisor: number | bigint,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  return money(divideRounded(amount, BigInt(divisor), mode))
}

/**
 * Splits an amount into weighted parts that sum back to exactly the original.
 *
 * Uses the largest-remainder method: floor every part, then hand the leftover minor
 * units to whichever parts were cut by the most. Rounding each part independently
 * would lose or invent cents, which is precisely the bug this exists to prevent.
 */
export function allocate(amount: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new RangeError('Cannot allocate across zero parts.')
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new RangeError('Allocation weights must be finite and non-negative.')
  }

  const totalWeight = weights.reduce((running, weight) => running + weight, 0)
  if (totalWeight <= 0) {
    throw new RangeError('Allocation weights must not all be zero.')
  }

  // Scale weights to integers so the division is exact.
  const scaledWeights = weights.map((weight) =>
    BigInt(Math.round((weight / totalWeight) * RATE_SCALE_AS_NUMBER)),
  )
  const scaledTotal = scaledWeights.reduce((running, weight) => running + weight, 0n)

  const negative = amount < 0n
  const magnitude = negative ? -amount : amount

  const parts: bigint[] = []
  const remainders: { index: number; remainder: bigint }[] = []
  let allocated = 0n

  for (const [index, weight] of scaledWeights.entries()) {
    const numerator = magnitude * weight
    const part = numerator / scaledTotal
    parts.push(part)
    remainders.push({ index, remainder: numerator % scaledTotal })
    allocated += part
  }

  // Distribute the shortfall, largest remainder first; ties break on index so the
  // result is deterministic.
  let leftover = magnitude - allocated
  const byLargestRemainder = remainders.toSorted((a, b) =>
    b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1,
  )

  for (const { index } of byLargestRemainder) {
    if (leftover <= 0n) break
    const part = parts[index]
    if (part === undefined) continue
    parts[index] = part + 1n
    leftover -= 1n
  }

  return parts.map((part) => money(negative ? -part : part))
}

export function compare(a: Money, b: Money): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function isZero(amount: Money): boolean {
  return amount === 0n
}

export function isNegative(amount: Money): boolean {
  return amount < 0n
}

export function isPositive(amount: Money): boolean {
  return amount > 0n
}

export function min(a: Money, b: Money): Money {
  return a < b ? a : b
}

export function max(a: Money, b: Money): Money {
  return a > b ? a : b
}

/** Clamps to the inclusive range `[lower, upper]`. */
export function clamp(amount: Money, lower: Money, upper: Money): Money {
  return min(max(amount, lower), upper)
}
