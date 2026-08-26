"use client"

import * as React from 'react'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Low-level table primitive used by `DataTable` and a handful of
 * direct consumers (`DictionaryEntriesEditor.tsx`). Phase B.6 polish
 * aligns the chrome with Figma `Table` page (`553:14955`):
 *
 * - `Table Header Cell [1.1]` (`587:5793`) — subtle `bg-muted/40`
 *   header strip + sortable chevron slot
 * - `Table Row Cell [1.1]` (`553:22175`) — comfortable padding,
 *   hover affordance
 * - `Sorting Icons [1.1]` (`581:2327`) — handled by DataTable
 * - Assembled examples in `Blocks` (167144:147461 et al.) confirm
 *   the chrome.
 *
 * Backward compatibility: every existing export (`Table`,
 * `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`)
 * stays callable verbatim. Header now ships a subtle `bg-muted/40`
 * strip — visible-but-soft polish per Figma. Row hover ships
 * `hover:bg-muted/30`. Both default to the new look since the spec
 * scope calls for "row-hover state token" + "header cell padding
 * alignment with Figma".
 *
 * New (additive):
 * - `<Table variant="striped">` — even-row bg-muted/20 tint per
 *   Figma striped block.
 * - `<TableFooter>` — bordered top footer row group.
 * - `<TableCaption>` — accessible caption above the table.
 */

type TableContextValue = {
  variant: 'default' | 'striped'
  density: TableDensity
}

const TableContext = React.createContext<TableContextValue>({ variant: 'default', density: 'default' })

export type TableVariant = 'default' | 'striped'

/**
 * Column alignment. `right` is for figures — amounts, quantities, counts — so
 * their digits line up on the decimal; `center` is for a column whose whole
 * content is one control or glyph; everything else is `left`.
 */
export type TableCellAlign = 'left' | 'right' | 'center'

const ALIGN_CLASS: Record<TableCellAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

/**
 * Row height. `default` is the page-owning list view; `compact` is a table
 * nested inside a card, panel or dialog that already carries its own padding —
 * the same header design either way, only the cell box changes, so a settings
 * matrix and a list page never look like two different components.
 */
export type TableDensity = 'default' | 'compact'

/**
 * `control` is for a column holding a single control — a select-all checkbox, a
 * row-actions kebab. Those want the cell to shrink to the control with an EQUAL
 * gutter either side; the reading padding of a text column leaves the control
 * adrift in a gutter twice its own width.
 */
export type TableCellPadding = 'default' | 'control'

/* Horizontal and vertical are separate axes: `control` overrides the reading
   inset without touching the row rhythm, so a checkbox column stays exactly as
   tall as the text columns beside it. */
const PADDING_X: Record<TableDensity, string> = {
  default: 'px-3 sm:px-5',
  compact: 'px-3',
}
const CONTROL_PADDING_X = 'w-px px-3'
const HEAD_PADDING_Y: Record<TableDensity, string> = {
  default: 'py-3',
  compact: 'py-2',
}
const CELL_PADDING_Y: Record<TableDensity, string> = {
  default: 'py-4',
  compact: 'py-2',
}

function resolvePaddingX(density: TableDensity, padding: TableCellPadding): string {
  return padding === 'control' ? CONTROL_PADDING_X : PADDING_X[density]
}

export type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /** `striped` adds even-row `bg-muted/20` tint per Figma. */
  variant?: TableVariant
  /** `compact` for tables nested in a card, panel or dialog. */
  density?: TableDensity
}

export function Table({ className, variant = 'default', density = 'default', ...props }: TableProps) {
  const contextValue = React.useMemo(() => ({ variant, density }), [variant, density])
  return (
    <TableContext.Provider value={contextValue}>
      <table
        data-slot="table"
        data-variant={variant}
        data-density={density}
        className={cn('w-full text-sm', className)}
        {...props}
      />
    </TableContext.Provider>
  )
}

/**
 * The header strip. The bottom rule lives on `TableHead` (the cell), NOT on the
 * row: `border-collapse: collapse` drops row borders on a `position: sticky`
 * header while it is scrolled, so a table that pins its header would lose the
 * only line separating it from the rows.
 */
export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead data-slot="table-header" className={cn('bg-table-header', className)} {...props} />
  )
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody data-slot="table-body" {...props} />
}

export function TableFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t border-table-border bg-table-header/70 text-xs font-medium', className)}
      {...props}
    />
  )
}

export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement>

export function TableRow({ className, ...props }: TableRowProps) {
  const { variant } = React.useContext(TableContext)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-table-border/60 last:border-b-0 transition-colors',
        // Row hover affordance — only applies to body rows (header
        // rows have their own strip and shouldn't bounce on hover).
        // Children inside <thead> bypass via CSS-attribute selectors
        // at the consumer level if needed.
        '[&:not(thead_*)]:hover:bg-table-row-hover',
        // Selection reads as a soft primary wash, distinct from hover.
        '[&:not(thead_*)][data-state=selected]:bg-table-selected',
        variant === 'striped' ? '[&:not(thead_*)]:even:bg-surface-muted/40' : '',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A column header.
 *
 * `align="right"` is the numeric treatment and it is a property of the COLUMN,
 * not of the cell: a right-aligned header over left-aligned figures (or the
 * reverse) is the single most common way a data table reads as unfinished, so
 * the same flag is passed to `TableCell` and both sides move together.
 *
 * The bottom rule is on the cell rather than the row so it survives a sticky
 * header — see `TableHeader`.
 */
export function TableHead({
  className,
  align = 'left',
  padding = 'default',
  ref,
  ...props
}: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'align'> & {
  align?: TableCellAlign
  padding?: TableCellPadding
  ref?: React.Ref<HTMLTableCellElement>
}) {
  const { density } = React.useContext(TableContext)
  return (
    <th
      ref={ref}
      data-slot="table-head"
      data-align={align}
      scope="col"
      className={cn(
        'border-b border-table-border align-middle text-xs font-bold uppercase tracking-wide whitespace-nowrap text-muted-foreground',
        HEAD_PADDING_Y[density],
        resolvePaddingX(density, padding),
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  )
}

/**
 * Sort state of a column: the active direction, or `false` when the column is
 * sortable but not currently ordering the rows.
 */
export type TableSortDirection = 'asc' | 'desc' | false

/**
 * Maps a sort direction to the `aria-sort` value the column header must expose.
 * A sortable-but-inactive column reports `none` — that is what tells a screen
 * reader the header IS sortable; omitting it announces a plain header.
 */
export function tableAriaSort(direction: TableSortDirection): React.AriaAttributes['aria-sort'] {
  if (direction === 'asc') return 'ascending'
  if (direction === 'desc') return 'descending'
  return 'none'
}

/**
 * The one sortable-column control. Every table that sorts renders THIS, so the
 * affordance, the emphasis and the keyboard behaviour are identical whether the
 * table is a `DataTable` list view or a hand-built panel table.
 *
 * It deliberately has no box — no fill, border or padding of its own — so the
 * label sits exactly where the cell padding puts it and stays flush with the
 * column of values beneath it. State is carried by ink, not by a container:
 * the label goes to full `foreground` when its column is the active sort, and
 * only the active direction's arrow takes the interactive accent. An inactive
 * column keeps a placeholder pair at the faintest ink in the ramp — present
 * enough to say "this sorts", quiet enough that a row of them does not compete
 * with the labels themselves.
 */
export function TableSortLabel({
  direction = false,
  onToggle,
  className,
  children,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onToggle'> & {
  direction?: TableSortDirection
  onToggle?: () => void
}) {
  return (
    <button
      type="button"
      data-slot="table-sort-label"
      data-direction={direction || 'none'}
      onClick={onToggle}
      className={cn(
        'group/sort inline-flex min-w-0 max-w-full cursor-pointer select-none items-center gap-1 text-left uppercase tracking-wide transition-colors',
        'hover:text-foreground focus:outline-none focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-4',
        direction ? 'text-foreground' : '',
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {direction === 'asc' ? (
        <ChevronUp className="size-3.5 shrink-0 text-accent-strong" aria-hidden="true" />
      ) : direction === 'desc' ? (
        <ChevronDown className="size-3.5 shrink-0 text-accent-strong" aria-hidden="true" />
      ) : (
        <ChevronsUpDown
          className="size-3.5 shrink-0 text-disabled-foreground transition-colors group-hover/sort:text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </button>
  )
}

export function TableCell({
  className,
  align = 'left',
  padding = 'default',
  ...props
}: Omit<React.TdHTMLAttributes<HTMLTableCellElement>, 'align'> & {
  align?: TableCellAlign
  padding?: TableCellPadding
}) {
  const { density } = React.useContext(TableContext)
  return (
    <td
      data-slot="table-cell"
      data-align={align}
      className={cn(
        // Stated rather than inherited: a cell that vertically centres in one
        // table and top-aligns in the next is the quiet source of rows that look
        // ragged. Call sites that want `align-top` pass it and win via twMerge.
        'align-middle text-sm font-medium text-foreground',
        CELL_PADDING_Y[density],
        resolvePaddingX(density, padding),
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  )
}

export function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-2 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
