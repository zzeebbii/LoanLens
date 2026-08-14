import type { YearMonth } from '@/domain/dates'

import { useLocale } from '@/app/providers/SettingsProvider'
import { formatPeriod } from '@/i18n/format'

/**
 * Renders a calendar month, formatted for the active locale.
 *
 * The prop is `format`, not `style`: `style` on a component reads as the DOM attribute, which
 * misleads anyone skimming the JSX and trips lint rules that assume it holds an object.
 */
export function Period({
  period,
  format = 'long',
  className,
}: {
  readonly period: YearMonth
  readonly format?: 'long' | 'short' | 'numeric'
  readonly className?: string
}) {
  const locale = useLocale()

  return (
    // `time` with a machine-readable value: the period is already ISO `YYYY-MM`.
    <time dateTime={period} className={className}>
      {formatPeriod(period, locale, format)}
    </time>
  )
}
