import { useMemo } from 'react'

import { useLocale } from '@/app/providers/SettingsProvider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { monthOf, parseYearMonth, yearMonth, yearOf } from '@/domain/dates'
import { cn } from '@/lib/cn'

/**
 * A month field: two selects, month and year.
 *
 * Not a calendar. A calendar asks which *day*, and every one of these fields wants a month —
 * when the first instalment falls, when the rate resets, when an overpayment starts. Picking
 * a month by clicking a day and having the day silently discarded is the kind of interface
 * that makes people distrust the numbers.
 *
 * Not `type="month"` either: only some browsers implement it, those that do render their own
 * unstyleable widget, and the rest degrade to a bare text box.
 *
 * The value is an ISO `YYYY-MM` string throughout — what `parseYearMonth` accepts and what
 * the domain's `YearMonth` already is.
 */
export interface MonthFieldProps {
  readonly id?: string
  readonly value: string
  onChange: (value: string) => void
  readonly 'aria-describedby'?: string | undefined
  readonly 'aria-invalid'?: boolean | undefined
  readonly disabled?: boolean
  readonly className?: string
  /** Earliest selectable year. Defaults to a decade before EURIBOR began. */
  readonly fromYear?: number
  /** Latest selectable year. Defaults to thirty years out, past any realistic term. */
  readonly toYear?: number
  readonly monthLabel: string
  readonly yearLabel: string
}

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export function MonthField({
  id,
  value,
  onChange,
  disabled = false,
  className,
  fromYear = 1990,
  toYear = new Date().getFullYear() + 30,
  monthLabel,
  yearLabel,
  ...props
}: MonthFieldProps) {
  const locale = useLocale()

  const parsed = parseYearMonth(value)
  const selectedYear = parsed === null ? new Date().getFullYear() : yearOf(parsed)
  const selectedMonth = parsed === null ? 1 : monthOf(parsed)

  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
    return MONTH_NUMBERS.map((month) => ({
      month,
      // Day 1 at midnight UTC cannot slide into the previous month in any time zone.
      name: formatter.format(new Date(Date.UTC(2026, month - 1, 1))),
    }))
  }, [locale])

  const years = useMemo(
    () => Array.from({ length: toYear - fromYear + 1 }, (_, index) => toYear - index),
    [fromYear, toYear],
  )

  const emit = (year: number, month: number) => onChange(yearMonth(year, month))

  return (
    <div className={cn('flex gap-2', className)}>
      <Select
        value={String(selectedMonth)}
        onValueChange={(month) => emit(selectedYear, Number(month))}
        disabled={disabled}
      >
        {/* The month select owns the field's id, so the label points at something focusable. */}
        <SelectTrigger id={id} className="flex-1" aria-label={monthLabel} {...props}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {monthNames.map((entry) => (
            <SelectItem key={entry.month} value={String(entry.month)}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(selectedYear)}
        onValueChange={(year) => emit(Number(year), selectedMonth)}
        disabled={disabled}
      >
        <SelectTrigger className="w-28" aria-label={yearLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* Newest first: a loan's dates are far more often recent than not. */}
          {years.map((year) => (
            <SelectItem key={year} value={String(year)}>
              <span className="tabular">{year}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
