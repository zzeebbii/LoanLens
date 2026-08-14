import type { ComponentProps } from 'react'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { DayPicker } from 'react-day-picker'

import { useLocale } from '@/app/providers/SettingsProvider'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/**
 * The calendar grid.
 *
 * Locale handling is done with `Intl` formatters rather than by importing a `date-fns`
 * locale bundle. Two reasons: it keeps the app's one source of locale truth — the user's
 * setting — driving the month and weekday names, and it avoids shipping a locale bundle
 * that would then have to be kept in step with the i18n resources.
 *
 * The heavy lifting that justifies the dependency is the keyboard grid: arrow keys across
 * days, page up/down across months, and the roving focus that makes a date grid usable
 * without a mouse. That is genuinely hard to get right by hand.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const locale = useLocale()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      formatters={{
        formatCaption: (month) =>
          new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month),
        formatWeekdayName: (weekday) =>
          new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(weekday),
        formatMonthDropdown: (month) =>
          new Intl.DateTimeFormat(locale, { month: 'long' }).format(month),
      }}
      classNames={{
        months: 'flex flex-col gap-4',
        month: 'space-y-3',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center justify-between absolute inset-x-1 top-1',
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-7 opacity-60 hover:opacity-100',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-7 opacity-60 hover:opacity-100',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-[0.7rem] font-normal text-muted-foreground',
        week: 'mt-1 flex w-full',
        day: 'relative size-9 p-0 text-center text-sm',
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-9 p-0 font-normal aria-selected:opacity-100',
        ),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        today: '[&>button]:bg-accent [&>button]:text-accent-foreground',
        outside: 'text-muted-foreground/50',
        disabled: 'text-muted-foreground/40 [&>button]:pointer-events-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === 'left' ? (
            <ChevronLeftIcon className="size-4" {...chevronProps} />
          ) : (
            <ChevronRightIcon className="size-4" {...chevronProps} />
          ),
      }}
      {...props}
    />
  )
}
