import type { AmortizationStrategy } from '@/domain/amortization/strategy'
import type { AmortizationType } from '@/domain/loan'

import { annuityStrategy } from '@/domain/amortization/annuity'

export type { AmortizationStrategy, InstalmentInput } from '@/domain/amortization/strategy'
export { annuityStrategy } from '@/domain/amortization/annuity'

const STRATEGIES: Readonly<Record<AmortizationType, AmortizationStrategy>> = {
  ANNUITY: annuityStrategy,
}

/**
 * Resolves the strategy for a repayment type.
 *
 * Keyed by `AmortizationType`, so adding a repayment shape is a compile error here
 * until the strategy exists — the registry cannot silently fall out of step with the
 * type union.
 */
export function strategyFor(type: AmortizationType): AmortizationStrategy {
  return STRATEGIES[type]
}
