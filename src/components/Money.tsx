import type { Money as MoneyAmount } from '@/domain/money'
import type { MoneyFormatOptions } from '@/i18n/format'

import { useLocale } from '@/app/providers/SettingsProvider'
import { isNegative, isPositive } from '@/domain/money'
import { formatMoney, toDecimalString } from '@/i18n/format'
import { cn } from '@/lib/cn'

/**
 * Renders a monetary amount.
 *
 * A component rather than a bare formatter call so three things are consistent everywhere
 * money appears: locale-aware formatting, tabular figures (so columns line up and do not
 * jitter as values change), and a machine-readable exact value in `data-value` for tests
 * and for anyone reading the DOM.
 */
export interface MoneyProps extends MoneyFormatOptions {
  readonly amount: MoneyAmount
  readonly currency: string
  readonly className?: string
  /** Colour positive green and negative red. For savings and differences only. */
  readonly colourBySign?: boolean
}

export function Money({
  amount,
  currency,
  className,
  colourBySign = false,
  ...options
}: MoneyProps) {
  const locale = useLocale()

  return (
    <span
      className={cn(
        'tabular',
        colourBySign && isPositive(amount) && 'text-success',
        colourBySign && isNegative(amount) && 'text-destructive',
        className,
      )}
      data-value={toDecimalString(amount)}
    >
      {formatMoney(amount, currency, locale, options)}
    </span>
  )
}
