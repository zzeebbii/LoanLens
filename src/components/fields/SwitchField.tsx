import type { ReactNode } from 'react'

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/cn'

/**
 * A toggle with its label, and optionally a line or two explaining what it does.
 *
 * Exists mainly to get the vertical alignment right in one place. Laying this out by hand as
 * `flex items-start` with a bare `<label>` inside a wrapper `div` looks correct and is not:
 * an inline label in an unstyled block inherits that block's line height — 1.5 at the root
 * font size, so 24px — rather than its own `text-sm` line height of 20px. The label's text is
 * then centred in a 24px line box while the switch beside it is 20px tall and pinned to the
 * top, leaving the two about 2px out of true. It goes unnoticed on a lone label and becomes
 * obvious once help text underneath makes the row tall enough to look at.
 *
 * Making the label a block whose line height matches the switch's height fixes it without a
 * nudge margin, so it stays right if either changes.
 */
export function SwitchField({
  id,
  checked,
  onCheckedChange,
  label,
  description,
  className,
}: {
  readonly id: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly label: ReactNode
  readonly description?: ReactNode
  /** For placing the row in a grid; the internal layout is not overridable. */
  readonly className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <div className="space-y-1">
        {/* `block` and `leading-5` are both load-bearing: together they make the label's box
            exactly as tall as the switch. See the note above. */}
        <label htmlFor={id} className="block text-sm leading-5 font-medium">
          {label}
        </label>
        {description !== undefined && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  )
}
