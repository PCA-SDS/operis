"use client"

import * as React from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { EmptyState } from '../primitives/empty-state'
import { TableCell, TableRow } from '../primitives/table'

export type TableEmptyRowProps = {
  /** Must span every rendered column, or the state sits under the first one. */
  colSpan: number
  title: string
  description?: string
  /** Defaults to the same Inbox glyph `DataTable` uses. */
  icon?: React.ReactNode
  /** `error` announces assertively — for a load failure, not an empty list. */
  tone?: 'default' | 'error'
  /** Buttons offering the way out ("Add the first one", "Clear filters"). */
  actions?: React.ReactNode
  className?: string
}

/**
 * The empty row for a hand-built table.
 *
 * `DataTable` already renders this state for the 100+ lists that go through it,
 * but a table assembled directly from the `Table` primitives had to spell it
 * out, and every one of them landed on a bare centred line of muted text — no
 * glyph, no description, nothing to act on. Beside a `DataTable` on the same
 * page they read as two different products.
 *
 * So this is that same state, extracted: identical markup to the `DataTable`
 * branch, down to the `variant="subtle"` (the surrounding table already draws
 * the border, so the dashed frame the standalone card uses would double it) and
 * the `size-6` Inbox glyph.
 *
 * It stays inside the table as a row-and-cell rather than sitting outside it.
 * The `Table` primitive is a CSS grid of divs carrying ARIA roles, not a real
 * `<table>`, so `colSpan` resolves to a `grid-column` span rather than an
 * attribute — which is exactly why the state has to live in a cell: outside the
 * grid it would lose the column geometry and the table's own horizontal
 * scroll. A `role="cell"` may hold a status region, so this stays valid ARIA;
 * what would not be valid is parking the copy directly under `role="table"`
 * or a `rowgroup`, which may only own rows.
 */
export function TableEmptyRow({
  colSpan,
  title,
  description,
  icon,
  tone,
  actions,
  className,
}: TableEmptyRowProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="p-0">
        {/* `w-full` is load-bearing: the cell is a flex container, so without it
            this box sizes to its content and `justify-center` has nothing to
            centre within — the state drifts to the left edge of a full-width
            row. DataTable reaches the same result by measuring the scroll
            viewport; here the grid already gives the cell the full span. */}
        <div className={cn('flex w-full justify-center py-6', className)}>
          <EmptyState
            variant="subtle"
            tone={tone}
            icon={icon ?? <Inbox className="size-6" aria-hidden />}
            title={title}
            description={description}
            actions={actions}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}
