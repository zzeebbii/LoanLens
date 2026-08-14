import type { YearMonth } from '@/domain/dates'

import { useMemo } from 'react'

import { yearMonth } from '@/domain/dates'

/**
 * The current calendar month.
 *
 * "Now" is deliberately not something the engine or the analytics know about — they take
 * `asOf` as a parameter so every figure is reproducible. This hook is the one place the app
 * asks the clock, which keeps that single impurity visible and easy to control in a test.
 *
 * Read once per mount rather than on a timer: a month boundary crossing mid-session is not
 * worth a re-render, and a reload picks it up.
 */
export function useCurrentPeriod(): YearMonth {
  return useMemo(() => {
    const now = new Date()
    return yearMonth(now.getFullYear(), now.getMonth() + 1)
  }, [])
}
