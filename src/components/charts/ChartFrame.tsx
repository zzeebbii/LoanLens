import { TableIcon } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/cn'

/**
 * The shell every chart sits in.
 *
 * It exists to make three things impossible to forget rather than optional:
 *
 *  - **A legend whenever there are two or more series.** Identity must never rest on
 *    colour-matching alone, and one of our hues sits below 3:1 on the light surface —
 *    the legend is part of what makes that acceptable.
 *  - **A table view.** Everything a tooltip can show is reachable without hovering, so
 *    the chart never gates a number behind a pointer. This is also the relief the
 *    palette's contrast warning requires.
 *  - **A described, labelled region.** A chart with no accessible name is invisible.
 *
 * A single series gets no legend box on purpose: there is one colour, and the title
 * already says what is plotted.
 */
export interface ChartLegendItem {
  readonly label: string
  readonly colour: string
  /** Lines key with a stroke, fills with a rectangle — mirroring the mark. */
  readonly shape?: 'line' | 'rect' | 'dashed'
}

export interface ChartFrameProps {
  readonly title: string
  readonly description?: string
  readonly legend?: readonly ChartLegendItem[]
  /** The table view. Rendered only when opened, so it costs nothing until asked for. */
  readonly table?: () => ReactNode
  /** Extra controls for this chart, placed beside the table toggle. */
  readonly controls?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

export function ChartFrame({
  title,
  description,
  legend,
  table,
  controls,
  children,
  className,
}: ChartFrameProps) {
  const { t } = useTranslation('charts')
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description !== undefined && <CardDescription>{description}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            {controls}
            {table !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTable(!showTable)}
                aria-expanded={showTable}
                aria-controls={tableId}
              >
                <TableIcon aria-hidden />
                {showTable ? t('accessibility.hideTable') : t('accessibility.showTable')}
              </Button>
            )}
          </div>
        </div>

        {/* A legend for two or more series, always. Never for one. */}
        {legend !== undefined && legend.length > 1 && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-xs">
                <ChartKey colour={item.colour} shape={item.shape ?? 'rect'} />
                {/* Text wears text tokens; the coloured key beside it carries identity. */}
                <span className="text-muted-foreground">{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <figure className="m-0">
          {children}
          <figcaption className="sr-only">
            {description === undefined ? title : `${title}. ${description}`}
          </figcaption>
        </figure>

        {showTable && table !== undefined && (
          <div id={tableId} className="max-h-80 overflow-auto rounded-lg border">
            {table()}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The legend key: a rectangle for fills, a short stroke for lines, a broken stroke for
 * dashed ones.
 *
 * The key mirrors how the mark is actually drawn, dash included. A solid key beside a dashed
 * line would be a small lie in exactly the place a reader goes to resolve which line is
 * which — and the dash is doing real work here as the non-colour half of the encoding.
 */
function ChartKey({
  colour,
  shape,
}: {
  readonly colour: string
  readonly shape: 'line' | 'rect' | 'dashed'
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0',
        shape === 'rect' ? 'size-2.5 rounded-sm' : 'h-0.5 w-3.5',
      )}
      style={
        shape === 'dashed'
          ? {
              backgroundImage: `repeating-linear-gradient(to right, ${colour} 0 4px, transparent 4px 7px)`,
            }
          : { backgroundColor: colour }
      }
    />
  )
}
