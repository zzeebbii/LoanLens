import type { ReactNode } from 'react'

import { useId } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/cn'

/**
 * Label, control, help text and error, wired together.
 *
 * The wiring is the reason this exists: `htmlFor`, `aria-describedby` and `aria-invalid` are
 * easy to omit one at a time across twenty fields, and each omission is invisible until
 * someone uses a screen reader. Doing it once means every field in the app is correct.
 */
export interface FormFieldProps {
  readonly label: string
  readonly help?: string
  readonly error?: string | undefined
  readonly children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => ReactNode
  readonly className?: string
}

export function FormField({ label, help, error, children, className }: FormFieldProps) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`

  const describedBy = [help === undefined ? null : helpId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(' ')

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{label}</Label>

      {children({
        id,
        'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
        'aria-invalid': error === undefined ? undefined : true,
      })}

      {help !== undefined && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
