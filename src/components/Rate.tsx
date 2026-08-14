import { useLocale } from '@/app/providers/SettingsProvider'
import { formatRate } from '@/i18n/format'
import { cn } from '@/lib/cn'

/** Renders an interest rate as a locale-formatted percentage, with tabular figures. */
export function Rate({
  value,
  decimals = 3,
  className,
}: {
  readonly value: number
  readonly decimals?: number
  readonly className?: string
}) {
  const locale = useLocale()

  return (
    <span className={cn('tabular', className)} data-value={value}>
      {formatRate(value, locale, decimals)}
    </span>
  )
}
