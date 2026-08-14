import type { ScenarioComparison, ScheduleTotals } from '@/domain/analytics'
import type { Loan } from '@/domain/loan'
import type { LoanEvent } from '@/domain/scenario'
import type { PaymentRow, ReferenceRateAt } from '@/domain/schedule'

import { useMemo } from 'react'

import { compareToBaseline, totals } from '@/domain/analytics'
import { MissingRateError, NonAmortizingLoanError, replay } from '@/domain/schedule'

/**
 * Running the engine from React.
 *
 * `replay` is pure and synchronous, so this is a `useMemo` and not a query — no loading
 * state, no race, no stale result. All the asynchrony lives in `useRateSeries`, which has
 * already resolved by the time a resolver reaches here.
 *
 * The engine throws for conditions the user needs to act on (a missing rate, a loan that
 * cannot amortise). Those are caught and returned rather than thrown, because they are
 * *expected outcomes of user input*, not bugs — a rendering error boundary would be the
 * wrong place to handle "you have not said what to assume about future rates".
 */

export interface ScheduleResult {
  readonly rows: readonly PaymentRow[]
  readonly totals: ScheduleTotals
  readonly error: null
}

export interface ScheduleFailure {
  readonly rows: null
  readonly totals: null
  readonly error: ScheduleError
}

export type ScheduleError =
  | { readonly kind: 'MISSING_RATE'; readonly period: string; readonly tenor: string }
  | { readonly kind: 'NON_AMORTIZING' }
  | { readonly kind: 'INVALID_LOAN'; readonly message: string }

export type Schedule = ScheduleResult | ScheduleFailure

function runReplay(loan: Loan, rateAt: ReferenceRateAt, events: readonly LoanEvent[]): Schedule {
  try {
    const rows = replay({ loan, referenceRateAt: rateAt, events })
    return { rows, totals: totals(rows), error: null }
  } catch (error) {
    if (error instanceof MissingRateError) {
      return {
        rows: null,
        totals: null,
        error: { kind: 'MISSING_RATE', period: error.period, tenor: error.index.tenor },
      }
    }
    if (error instanceof NonAmortizingLoanError) {
      return { rows: null, totals: null, error: { kind: 'NON_AMORTIZING' } }
    }
    if (error instanceof RangeError) {
      return { rows: null, totals: null, error: { kind: 'INVALID_LOAN', message: error.message } }
    }
    throw error
  }
}

export interface UseScheduleOptions {
  readonly loan: Loan | null | undefined
  readonly rateAt: ReferenceRateAt | undefined
  readonly events?: readonly LoanEvent[]
}

/** The schedule for a loan under a given set of events. `null` until inputs are ready. */
export function useSchedule({ loan, rateAt, events = [] }: UseScheduleOptions): Schedule | null {
  return useMemo(() => {
    if (loan == null || rateAt === undefined) return null
    return runReplay(loan, rateAt, events)
  }, [loan, rateAt, events])
}

export interface UseScenarioComparisonOptions {
  readonly loan: Loan | null | undefined
  readonly rateAt: ReferenceRateAt | undefined
  readonly events: readonly LoanEvent[]
}

export interface ScenarioComparisonResult {
  readonly baseline: Schedule
  readonly scenario: Schedule
  readonly comparison: ScenarioComparison | null
}

/**
 * Baseline and scenario, replayed and compared.
 *
 * Both sides go through the identical code path with the identical rate data; the only
 * difference is the events array. That is what makes the comparison worth showing.
 */
export function useScenarioComparison({
  loan,
  rateAt,
  events,
}: UseScenarioComparisonOptions): ScenarioComparisonResult | null {
  return useMemo(() => {
    if (loan == null || rateAt === undefined) return null

    const baseline = runReplay(loan, rateAt, [])
    const scenario = runReplay(loan, rateAt, events)

    return {
      baseline,
      scenario,
      comparison:
        baseline.rows === null || scenario.rows === null
          ? null
          : compareToBaseline(baseline.rows, scenario.rows),
    }
  }, [loan, rateAt, events])
}
