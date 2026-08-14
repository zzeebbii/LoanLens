import type { ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * The table behind a chart.
 *
 * Not a fallback in the sense of "shown when the chart fails" — it is always available,
 * because a tooltip must enhance rather than gate. Every number a hover can reveal is
 * reachable here without a pointer, which is what makes the chart usable by keyboard, by
 * screen reader, and by anyone comparing two values that are far apart on screen.
 */
export interface ChartTableColumn<Row> {
  readonly header: string
  readonly cell: (row: Row) => ReactNode
  readonly align?: 'left' | 'right'
}

export function ChartDataTable<Row>({
  title,
  rows,
  columns,
  rowKey,
}: {
  readonly title: string
  readonly rows: readonly Row[]
  readonly columns: readonly ChartTableColumn<Row>[]
  readonly rowKey: (row: Row, index: number) => string
}) {
  const { t } = useTranslation('charts')

  return (
    <Table>
      <TableCaption className="sr-only">{t('accessibility.tableCaption', { title })}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.header}
              className={column.align === 'right' ? 'text-right' : undefined}
              scope="col"
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={rowKey(row, index)}>
            {columns.map((column) => (
              <TableCell
                key={column.header}
                className={column.align === 'right' ? 'text-right' : undefined}
              >
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
