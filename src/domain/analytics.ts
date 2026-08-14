import type { YearMonth } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { Money } from '@/domain/money'
import type { LoanEvent } from '@/domain/scenario'
import type { PaymentRow, ReferenceRateAt } from '@/domain/schedule'

import { compareYearMonth, monthsBetween, yearOf } from '@/domain/dates'
import { add, isPositive, subtract, sum, ZERO } from '@/domain/money'
import { replay } from '@/domain/schedule'

/**
 * Derived figures. Everything here is a fold over `PaymentRow[]`, so the tables and all
 * eleven charts are reading the same numbers rather than each recomputing their own.
 */

export interface ScheduleTotals {
  readonly periods: number
  readonly principal: Money
  readonly interest: Money
  readonly capitalisedInterest: Money
  readonly fees: Money
  readonly extraPayments: Money
  /** Everything the borrower hands over across the whole loan. */
  readonly totalPaid: Money
  readonly firstPeriod: YearMonth | null
  /** The period the loan is settled in — the answer to "when am I done?". */
  readonly payoffPeriod: YearMonth | null
  /** Interest as a share of the principal, e.g. `0.486` for 48.6%. */
  readonly interestRatio: number
}

export function totals(rows: readonly PaymentRow[]): ScheduleTotals {
  const interest = sum(rows.map((row) => row.interest))
  // Capital and extra payments both retire principal; interest that was capitalised
  // rather than paid inflates capital, so netting it off recovers the original amount.
  const principal = subtract(
    sum(rows.map((row) => add(row.capital, row.extraPayment))),
    sum(rows.map((row) => row.capitalisedInterest)),
  )

  return {
    periods: rows.length,
    principal,
    interest,
    capitalisedInterest: sum(rows.map((row) => row.capitalisedInterest)),
    fees: sum(rows.map((row) => row.fees)),
    extraPayments: sum(rows.map((row) => row.extraPayment)),
    totalPaid: sum(rows.map((row) => row.totalPaid)),
    firstPeriod: rows[0]?.period ?? null,
    payoffPeriod: rows.at(-1)?.period ?? null,
    interestRatio: isPositive(principal) ? Number(interest) / Number(principal) : 0,
  }
}

export interface YearSummary {
  readonly year: number
  readonly interest: Money
  readonly capital: Money
  readonly fees: Money
  readonly extraPayments: Money
  readonly totalPaid: Money
  /** Balance after the last instalment of the year. */
  readonly closingBalance: Money
}

/**
 * Rolls the schedule up by calendar year.
 *
 * Monthly resolution is unreadable over 25 years; a year is the unit people actually
 * think in when they ask what the loan is costing them.
 */
export function byYear(rows: readonly PaymentRow[]): YearSummary[] {
  const summaries = new Map<number, YearSummary>()

  for (const row of rows) {
    const year = yearOf(row.period)
    const running = summaries.get(year)

    summaries.set(year, {
      year,
      interest: add(running?.interest ?? ZERO, row.interest),
      capital: add(running?.capital ?? ZERO, row.capital),
      fees: add(running?.fees ?? ZERO, row.fees),
      extraPayments: add(running?.extraPayments ?? ZERO, row.extraPayment),
      totalPaid: add(running?.totalPaid ?? ZERO, row.totalPaid),
      // Overwritten each month, so it ends up being December's closing balance.
      closingBalance: row.closingBalance,
    })
  }

  return [...summaries.values()].toSorted((a, b) => a.year - b.year)
}

export interface ProgressToDate {
  /** Instalments already due as of `asOf`, inclusive. */
  readonly periodsElapsed: number
  readonly periodsRemaining: number
  readonly paidToDate: Money
  readonly interestToDate: Money
  readonly capitalToDate: Money
  readonly feesToDate: Money
  readonly remainingBalance: Money
  readonly remainingInterest: Money
  /** Share of the original principal repaid, 0 to 1. */
  readonly capitalRepaidRatio: number
}

/**
 * Splits the schedule at `asOf` into what has happened and what is still to come.
 *
 * `asOf` is a parameter rather than "now" so the engine stays pure and the same figures
 * can be recomputed for any point in the loan's life.
 */
export function progressToDate(rows: readonly PaymentRow[], asOf: YearMonth): ProgressToDate {
  const elapsed = rows.filter((row) => compareYearMonth(row.period, asOf) <= 0)
  const remaining = rows.filter((row) => compareYearMonth(row.period, asOf) > 0)
  const originalPrincipal = rows[0]?.openingBalance ?? ZERO
  const capitalToDate = sum(elapsed.map((row) => add(row.capital, row.extraPayment)))

  return {
    periodsElapsed: elapsed.length,
    periodsRemaining: remaining.length,
    paidToDate: sum(elapsed.map((row) => row.totalPaid)),
    interestToDate: sum(elapsed.map((row) => row.interest)),
    capitalToDate,
    feesToDate: sum(elapsed.map((row) => row.fees)),
    remainingBalance: elapsed.at(-1)?.closingBalance ?? originalPrincipal,
    remainingInterest: sum(remaining.map((row) => row.interest)),
    capitalRepaidRatio: isPositive(originalPrincipal)
      ? Number(capitalToDate) / Number(originalPrincipal)
      : 0,
  }
}

export interface ScenarioComparison {
  readonly interestSaved: Money
  readonly feesSaved: Money
  /** Total outlay avoided — negative if the scenario costs more overall. */
  readonly totalSaved: Money
  readonly monthsSaved: number
  readonly baselinePayoffPeriod: YearMonth | null
  readonly scenarioPayoffPeriod: YearMonth | null
  readonly extraPaid: Money
  /**
   * Interest avoided per unit overpaid — e.g. `0.28` means every €1 of overpayment
   * saved 28 cents of interest.
   *
   * Not a rate of return, and normally well below 1. The overpayment itself is not
   * lost: it retires principal that was owed regardless. This measures only the
   * interest that principal would otherwise have accrued.
   */
  readonly interestSavedPerUnitOverpaid: number
}

/** Compares a scenario against the baseline schedule. */
export function compareToBaseline(
  baseline: readonly PaymentRow[],
  scenario: readonly PaymentRow[],
): ScenarioComparison {
  const base = totals(baseline)
  const alternative = totals(scenario)

  const interestSaved = subtract(base.interest, alternative.interest)
  const monthsSaved =
    base.payoffPeriod !== null && alternative.payoffPeriod !== null
      ? monthsBetween(alternative.payoffPeriod, base.payoffPeriod)
      : 0

  return {
    interestSaved,
    feesSaved: subtract(base.fees, alternative.fees),
    totalSaved: subtract(base.totalPaid, alternative.totalPaid),
    monthsSaved,
    baselinePayoffPeriod: base.payoffPeriod,
    scenarioPayoffPeriod: alternative.payoffPeriod,
    extraPaid: alternative.extraPayments,
    interestSavedPerUnitOverpaid: isPositive(alternative.extraPayments)
      ? Number(interestSaved) / Number(alternative.extraPayments)
      : 0,
  }
}

export interface BreakEvenPoint {
  readonly period: YearMonth
  /** Instalments from the start of the loan to the crossover. */
  readonly monthsFromStart: number
  readonly cumulativeBaselinePaid: Money
  readonly cumulativeScenarioPaid: Money
  /** The most the scenario was ever out of pocket against the baseline. */
  readonly peakAdditionalOutlay: Money
}

/**
 * The month from which overpaying has left the borrower ahead in pure cash terms.
 *
 * Compares *cumulative total outlay*, not interest saved against extra paid. The
 * tempting version — "when does interest saved overtake what I put in?" — never crosses,
 * and the reason is worth stating: an overpayment is not a cost. It retires principal
 * the borrower owed anyway, so it is money moved earlier in time rather than money lost.
 * Measuring it as a cost makes overpaying look like it never pays back, which is wrong.
 *
 * What genuinely changes is the cash flow. The scenario runs ahead of the baseline while
 * it is paying more each month, then the baseline keeps paying after the scenario's loan
 * is settled. The crossover is where cumulative spend equalises, and it is the honest
 * answer to "when am I actually better off?".
 *
 * Returns `null` if the scenario is never out of pocket to begin with — nothing to
 * break even on.
 */
export function breakEven(
  baseline: readonly PaymentRow[],
  scenario: readonly PaymentRow[],
): BreakEvenPoint | null {
  let baselinePaid = ZERO
  let scenarioPaid = ZERO
  let peakAdditionalOutlay = ZERO
  let hasBeenBehind = false

  const horizon = Math.max(baseline.length, scenario.length)

  for (let position = 0; position < horizon; position += 1) {
    const baselineRow = baseline[position]
    const scenarioRow = scenario[position]

    baselinePaid = add(baselinePaid, baselineRow?.totalPaid ?? ZERO)
    scenarioPaid = add(scenarioPaid, scenarioRow?.totalPaid ?? ZERO)

    const difference = subtract(scenarioPaid, baselinePaid)
    if (isPositive(difference)) {
      hasBeenBehind = true
      if (difference > peakAdditionalOutlay) peakAdditionalOutlay = difference
      continue
    }

    const period = scenarioRow?.period ?? baselineRow?.period
    if (hasBeenBehind && period !== undefined) {
      return {
        period,
        monthsFromStart: position + 1,
        cumulativeBaselinePaid: baselinePaid,
        cumulativeScenarioPaid: scenarioPaid,
        peakAdditionalOutlay,
      }
    }
  }

  return null
}

export interface CapEffect {
  /** False when neither the loan nor the scenario puts a cap in force. */
  readonly hasCap: boolean
  /** Interest the ceiling prevented. Exactly zero for a cap that never binds. */
  readonly interestAvoided: Money
  /**
   * What the cap cost, all in: the premium charged, plus the knock-on of having paid it.
   *
   * A premium raises the rate, which changes the whole amortization path, so the cost is
   * slightly more than the sum of the premium charges themselves. The raw charge is on each
   * row as `capPremium` if you want it; this is the figure that belongs in a decision.
   */
  readonly premiumCost: Money
  /** `interestAvoided - premiumCost`. Negative means the cap cost more than it saved. */
  readonly net: Money
  readonly worthwhile: boolean
}

export interface CapEffectInput {
  readonly loan: Loan
  readonly rateAt: ReferenceRateAt
  readonly events?: readonly LoanEvent[]
}

/** The same loan with every cap removed, from both the loan terms and the events. */
function withoutCaps(loan: Loan, events: readonly LoanEvent[]) {
  return {
    loan:
      loan.rateBasis.kind === 'FLOATING'
        ? { ...loan, rateBasis: { ...loan.rateBasis, cap: null } }
        : loan,
    events: events.filter((event) => event.kind !== 'RATE_CAP'),
  }
}

/** The same loan with every cap kept but free of charge. */
function withoutPremiums(loan: Loan, events: readonly LoanEvent[]) {
  return {
    loan:
      loan.rateBasis.kind === 'FLOATING' && loan.rateBasis.cap !== null
        ? {
            ...loan,
            rateBasis: { ...loan.rateBasis, cap: { ...loan.rateBasis.cap, premiumBps: 0 } },
          }
        : loan,
    events: events.map((event) =>
      event.kind === 'RATE_CAP' ? { ...event, premiumBps: 0 } : event,
    ),
  }
}

/**
 * What a rate cap cost and what it saved — the answer to "was it worth buying?".
 *
 * Takes the loan rather than pre-built schedules because it needs *three* replays, and
 * getting them consistent is exactly the thing a caller would get wrong: the same loan with
 * no cap, with the ceiling but no premium, and with both.
 *
 * The middle one is what makes the split exact. Measuring the ceiling's benefit by comparing
 * the uncapped schedule against the fully-capped one conflates two effects, because the
 * premium raises the rate and so changes the amortization path as well. On a cap that never
 * binds that artefact showed up as several hundred euros of "avoided" interest on protection
 * that had done nothing at all. Splitting at the no-premium schedule attributes each half to
 * its own cause, and the two still reconcile: `interestAvoided - premiumCost` equals the
 * observable difference in total interest.
 *
 * Netting alone would not be enough to decide with either. A cap that saved €9,000 and cost
 * €7,000 nets to the same €2,000 as one that saved €2,000 and cost nothing, and they are
 * entirely different products at entirely different prices.
 */
export function capEffect({ loan, rateAt, events = [] }: CapEffectInput): CapEffect {
  const uncapped = withoutCaps(loan, events)
  const free = withoutPremiums(loan, events)

  const interestOf = (input: { loan: Loan; events: readonly LoanEvent[] }) =>
    sum(
      replay({ loan: input.loan, referenceRateAt: rateAt, events: input.events }).map(
        (row) => row.interest,
      ),
    )

  const withoutCapInterest = interestOf(uncapped)
  const ceilingOnlyInterest = interestOf(free)
  const withCapInterest = interestOf({ loan, events })

  const interestAvoided = subtract(withoutCapInterest, ceilingOnlyInterest)
  const premiumCost = subtract(withCapInterest, ceilingOnlyInterest)

  return {
    hasCap:
      (loan.rateBasis.kind === 'FLOATING' && loan.rateBasis.cap !== null) ||
      events.some((event) => event.kind === 'RATE_CAP'),
    interestAvoided,
    premiumCost,
    // Equal to `withoutCapInterest - withCapInterest` by construction, which is what makes
    // the two halves trustworthy: they add back up to something directly observable.
    net: subtract(interestAvoided, premiumCost),
    worthwhile: isPositive(subtract(interestAvoided, premiumCost)),
  }
}

export interface RunningTotalsRow {
  readonly period: YearMonth
  readonly cumulativeInterest: Money
  readonly cumulativeCapital: Money
  readonly cumulativeFees: Money
  readonly cumulativePaid: Money
  readonly balance: Money
}

/** Running totals per period, for cumulative charts. */
export function runningTotals(rows: readonly PaymentRow[]): RunningTotalsRow[] {
  let interest = ZERO
  let capital = ZERO
  let fees = ZERO
  let paid = ZERO

  return rows.map((row) => {
    interest = add(interest, row.interest)
    capital = add(capital, add(row.capital, row.extraPayment))
    fees = add(fees, row.fees)
    paid = add(paid, row.totalPaid)

    return {
      period: row.period,
      cumulativeInterest: interest,
      cumulativeCapital: capital,
      cumulativeFees: fees,
      cumulativePaid: paid,
      balance: row.closingBalance,
    }
  })
}

/** The period in which the capital portion first exceeds the interest portion. */
export function crossoverPeriod(rows: readonly PaymentRow[]): YearMonth | null {
  return rows.find((row) => row.capital > row.interest)?.period ?? null
}
