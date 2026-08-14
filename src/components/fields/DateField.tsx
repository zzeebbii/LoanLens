import type { LocalDate } from '@/domain/dates'

import { CalendarIcon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLocale } from '@/app/providers/SettingsProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatLocalDate, localDate, parseLocalDate } from '@/domain/dates'
import { formatDate } from '@/i18n/format'
import { cn } from '@/lib/cn'

/**
 * The calendar grid is loaded when the popover first opens.
 *
 * `react-day-picker` and its date library are around 22 kB gzipped, and nothing shows a
 * calendar until this button is pressed — on most visits, never. Splitting it here keeps that
 * weight off the first paint, and the popover only mounts its content when open, so the
 * import fires exactly once and exactly when it is needed.
 */
const Calendar = lazy(async () => ({
  default: (await import('@/components/ui/calendar')).Calendar,
}))

/**
 * A date field: a text input you can type into, with a calendar beside it.
 *
 * Both, deliberately. A drawdown date is often years in the past, and reaching 2021 by
 * clicking a month-back arrow forty times is miserable — typing is far quicker. But a
 * calendar is the better tool for a nearby date and for confirming which weekday something
 * falls on. Offering only one of the two makes half the cases painful.
 *
 * The value is always an ISO `YYYY-MM-DD` string, which is what the form draft stores and
 * what `parseLocalDate` accepts. The calendar's `Date` never escapes this component: it is
 * converted at the boundary, so nothing downstream inherits a timestamp with a time zone.
 */
export interface DateFieldProps {
  readonly id?: string
  readonly value: string
  onChange: (value: string) => void
  onBlur?: () => void
  readonly name?: string
  readonly 'aria-describedby'?: string | undefined
  readonly 'aria-invalid'?: boolean | undefined
  readonly disabled?: boolean
  readonly className?: string
}

export function DateField({ value, onChange, className, ...props }: DateFieldProps) {
  const { t } = useTranslation('common')
  const locale = useLocale()
  const [open, setOpen] = useState(false)

  const parsed = parseLocalDate(value)

  return (
    <div className={cn('flex gap-2', className)}>
      <Input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="2021-02-15"
        inputMode="numeric"
        autoComplete="off"
        // Not `type="date"`. The native control renders the browser's own picker, which
        // ignores the app's styling entirely and looks like a different product.
        type="text"
        className="font-mono"
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={props.disabled ?? false}
            aria-label={t('date.openCalendar')}
          >
            <CalendarIcon aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end">
          <Suspense fallback={<div className="size-64" aria-hidden />}>
            <Calendar
              mode="single"
              autoFocus
              {...(parsed === null
                ? {}
                : {
                    selected: new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)),
                    defaultMonth: new Date(Date.UTC(parsed.year, parsed.month - 1, 1)),
                  })}
              onSelect={(picked) => {
                if (picked === undefined) return
                // The calendar works in local time; read the local parts so the day the user
                // clicked is the day that lands in the field.
                onChange(
                  formatLocalDate(
                    localDate(picked.getFullYear(), picked.getMonth() + 1, picked.getDate()),
                  ),
                )
                setOpen(false)
              }}
            />
          </Suspense>
          {parsed !== null && (
            <p className="mt-2 border-t pt-2 text-center text-xs text-muted-foreground">
              {formatDate(parsed as LocalDate, locale, 'long')}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
