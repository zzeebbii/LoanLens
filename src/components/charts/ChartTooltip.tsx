import type { ReactNode } from 'react'

/**
 * The tooltip body.
 *
 * Two rules from the design guidance are baked in:
 *
 *  - **The value leads, the label follows.** This is the legend's hierarchy inverted:
 *    in a legend the reader wants the name, in a tooltip they already have the series
 *    and want the number, so the number is the high-contrast element.
 *  - **Line keys, not filled boxes.** At tooltip density a filled swatch is
 *    data-weight ink doing a label's job.
 *
 * Series names arrive as plain strings and are rendered as text nodes by React, never
 * as markup — they can originate from a loan the user named themselves.
 */
export interface TooltipRow {
  readonly label: string
  readonly value: ReactNode
  readonly colour?: string
}

export function ChartTooltip({
  heading,
  rows,
  footer,
}: {
  readonly heading: ReactNode
  readonly rows: readonly TooltipRow[]
  readonly footer?: ReactNode
}) {
  return (
    <div className="pointer-events-none min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-popover-foreground">{heading}</p>

      <dl className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-2">
            {row.colour !== undefined && (
              <span
                aria-hidden
                className="mt-1 inline-block h-0.5 w-3 shrink-0"
                style={{ backgroundColor: row.colour }}
              />
            )}
            {/* Value first and strong; the name is secondary. */}
            <dd className="tabular order-2 ml-auto font-medium text-popover-foreground">
              {row.value}
            </dd>
            <dt className="order-1 text-muted-foreground">{row.label}</dt>
          </div>
        ))}
      </dl>

      {footer !== undefined && (
        <p className="mt-1.5 border-t pt-1.5 text-muted-foreground">{footer}</p>
      )}
    </div>
  )
}
