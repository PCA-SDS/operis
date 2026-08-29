"use client"

import * as React from 'react'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The product's one table.
 *
 * It is a CSS **grid**, not an HTML `<table>`: one `gridTemplateColumns` track
 * list declared on the container and repeated on every row, with ARIA roles
 * carrying the semantics an element name would otherwise carry. That is what
 * lets a column change width — a user drag, a column hiding itself on a narrow
 * container — as a single animatable property on the row instead of a reflow of
 * every cell, and it is why rows can be virtualised, reordered and pinned
 * without fighting table layout.
 *
 * The compound API (`Table` / `TableHeader` / `TableRow` / `TableHead` /
 * `TableCell`) is unchanged from the markup it replaces, so call sites read the
 * same; only `Table` gains the track list.
 *
 * Rows stay `w-full` so every row resolves `fr` against the SAME width.
 * Horizontal growth lives on one wrapper (`w-max min-w-full`) — putting `w-max`
 * on each row makes the header and body compute different track sizes from
 * different cell content.
 */

type TableContextValue = {
  variant: TableVariant
  density: TableDensity
  columns: string[]
  gridStyle: React.CSSProperties
}

const TableContext = React.createContext<TableContextValue>({
  variant: 'default',
  density: 'default',
  columns: [],
  gridStyle: {},
})

export type TableVariant = 'default' | 'striped'

/**
 * Column alignment. `right` is for figures — amounts, quantities, counts — so
 * their digits line up on the decimal; `center` is for a column whose whole
 * content is one control or glyph; everything else is `left`.
 */
export type TableCellAlign = 'left' | 'right' | 'center'

const ALIGN_CLASS: Record<TableCellAlign, string> = {
  left: 'justify-start text-left',
  right: 'justify-end text-right',
  center: 'justify-center text-center',
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
 * row-actions kebab. Those want an EQUAL, tighter gutter either side; the
 * reading padding of a text column leaves the control adrift.
 */
export type TableCellPadding = 'default' | 'control'

const PADDING_X: Record<TableDensity, string> = {
  default: 'px-3 sm:px-5',
  compact: 'px-3',
}
const CONTROL_PADDING_X = 'px-3'
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

/**
 * `fr` tracks only overflow when their *minimum* size sums wider than the
 * scrollport. Callers reach for `minmax(0, 1fr)`, which collapses under a
 * `w-full` grid and never triggers horizontal scroll — so a zero/missing min is
 * floored, letting a wide table scroll instead of crushing its headers. Fixed
 * rem/px tracks and already-bounded `minmax()` are left alone.
 */
const ZERO_MIN = /^(0|0px|0rem|0em|0fr|0%)$/i
const DEFAULT_COLUMN_MIN = '8rem'

export function resolveGridColumnWidth(width: string): string {
  const trimmed = width.trim()
  const minmax = trimmed.match(/^minmax\(\s*([^,]+)\s*,\s*(.+)\s*\)$/i)
  if (minmax) {
    const min = minmax[1]!.trim()
    const max = minmax[2]!.trim()
    return ZERO_MIN.test(min) ? `minmax(${DEFAULT_COLUMN_MIN}, ${max})` : trimmed
  }
  if (/^\d+(\.\d+)?fr$/i.test(trimmed)) return `minmax(${DEFAULT_COLUMN_MIN}, ${trimmed})`
  return trimmed
}

/** A hidden column collapses to a zero track rather than unmounting, so the row animates shut. */
export const TABLE_COLLAPSED_COLUMN = 'minmax(0,0fr)'
/** The width a column of one icon button wants. */
export const TABLE_ICON_COLUMN_WIDTH = '4.75rem'

/* One transition on one property: the row's own track list. Every cell moves
   with it for free, which is what makes a resize or a column hiding itself read
   as the column moving rather than as the table re-laying out. */
const ROW_GRID_CLASS =
  'grid w-full transition-[grid-template-columns,background-color,color] duration-300 ease-out motion-reduce:transition-none'

export type TableProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> & {
  /**
   * Grid track per column, in order — `'minmax(0,2fr)'`, `'6.5rem'`,
   * `TABLE_ICON_COLUMN_WIDTH`. Omit to give every column an equal share.
   */
  columns?: string[]
  /** `striped` tints even rows. */
  variant?: TableVariant
  /** `compact` for tables nested in a card, panel or dialog. */
  density?: TableDensity
  /** Number of columns when `columns` is omitted — used to build equal tracks. */
  columnCount?: number
}

export function Table({
  className,
  columns,
  columnCount,
  variant = 'default',
  density = 'default',
  children,
  ...props
}: TableProps) {
  const tracks = React.useMemo(() => {
    if (columns && columns.length) return columns.map(resolveGridColumnWidth)
    const count = Math.max(1, columnCount ?? 1)
    return Array.from({ length: count }, () => resolveGridColumnWidth('minmax(0,1fr)'))
  }, [columns, columnCount])

  const contextValue = React.useMemo<TableContextValue>(
    () => ({ variant, density, columns: tracks, gridStyle: { gridTemplateColumns: tracks.join(' ') } }),
    [variant, density, tracks],
  )

  return (
    <TableContext.Provider value={contextValue}>
      <div
        role="table"
        data-slot="table"
        data-variant={variant}
        data-density={density}
        className={cn('w-full text-sm', className)}
        {...props}
      >
        <div className="w-max min-w-full">{children}</div>
      </div>
    </TableContext.Provider>
  )
}

/**
 * The header strip. It separates from the rows by TONE, not by a rule — the step
 * from the strip's fill to the row ground is the edge, and a border drawn on top
 * of it reads as a second, competing line.
 *
 * `sticky` only when the table owns a vertical scrollport — pinned without one it
 * sticks to the viewport and slides under the app topbar.
 */
export function TableHeader({
  className,
  sticky = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { sticky?: boolean }) {
  return (
    <div
      role="rowgroup"
      data-slot="table-header"
      className={cn('bg-table-header', sticky && 'sticky top-0 z-20', className)}
      {...props}
    />
  )
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="rowgroup" data-slot="table-body" className={className} {...props} />
}

export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="rowgroup"
      data-slot="table-footer"
      className={cn('border-t border-table-border bg-table-header/70 text-xs font-medium', className)}
      {...props}
    />
  )
}

export type TableRowProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'role'>

export function TableRow({ className, style, ...props }: TableRowProps) {
  const { variant, gridStyle } = React.useContext(TableContext)
  return (
    <div
      role="row"
      data-slot="table-row"
      style={{ ...gridStyle, ...style }}
      className={cn(
        ROW_GRID_CLASS,
        'border-b border-table-border/60 last:border-b-0',
        // Header rows carry their own strip and must not bounce on hover.
        '[&:not([data-slot=table-header]_*)]:hover:bg-table-row-hover',
        /* Selection reads as a soft primary wash AND recolours the row's ink, so
           a selected row is legible as selected from the text alone — not only
           from a tint a low-contrast display can flatten away. */
        '[&:not([data-slot=table-header]_*)][data-state=selected]:bg-table-selected',
        '[&:not([data-slot=table-header]_*)][data-state=selected]:text-accent-strong',
        variant === 'striped' ? '[&:not([data-slot=table-header]_*)]:even:bg-surface-muted/40' : '',
        className,
      )}
      {...props}
    />
  )
}

/** Cells span a range of tracks the way `colSpan` spans table columns. */
function spanStyle(colSpan: number | undefined, columnCount: number): React.CSSProperties | undefined {
  if (!colSpan || colSpan <= 1) return undefined
  return colSpan >= columnCount ? { gridColumn: '1 / -1' } : { gridColumn: `span ${colSpan}` }
}

/**
 * A column header.
 *
 * `align="right"` is a property of the COLUMN, not of the cell: a right-aligned
 * header over left-aligned figures (or the reverse) is the single most common
 * way a data table reads as unfinished, so the same flag goes to `TableCell` and
 * both sides move together.
 */
export function TableHead({
  className,
  align = 'left',
  padding = 'default',
  colSpan,
  style,
  ref,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'align' | 'role'> & {
  align?: TableCellAlign
  padding?: TableCellPadding
  colSpan?: number
  ref?: React.Ref<HTMLDivElement>
}) {
  const { density, columns } = React.useContext(TableContext)
  return (
    <div
      ref={ref}
      role="columnheader"
      data-slot="table-head"
      data-align={align}
      style={{ ...spanStyle(colSpan, columns.length), ...style }}
      className={cn(
        'flex min-w-0 items-center overflow-hidden whitespace-nowrap text-xs font-bold uppercase tracking-wide text-muted-foreground',
        HEAD_PADDING_Y[density],
        resolvePaddingX(density, padding),
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  align = 'left',
  padding = 'default',
  colSpan,
  style,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'align' | 'role'> & {
  align?: TableCellAlign
  padding?: TableCellPadding
  colSpan?: number
}) {
  const { density, columns } = React.useContext(TableContext)
  return (
    <div
      role="cell"
      data-slot="table-cell"
      data-align={align}
      style={{ ...spanStyle(colSpan, columns.length), ...style }}
      className={cn(
        /* `whitespace-nowrap` is what makes every row exactly one line tall — the
           most visible structural property of the table. A cell that genuinely
           holds prose opts out with `whitespace-normal`; a cell holding a stacked
           pair keeps its own `flex-col` and is unaffected. */
        'flex min-w-0 items-center overflow-hidden whitespace-nowrap text-sm font-medium text-foreground',
        CELL_PADDING_Y[density],
        resolvePaddingX(density, padding),
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  )
}

/**
 * The leading marker on a selected row: a short accent bar that grows out of the
 * first cell's left edge. It carries the state where the eye enters the row
 * rather than relying on a wash that is easy to miss on a dense list, and it
 * occupies no width when inactive, so unselected rows keep their content in
 * place.
 */
export function TableRowMarker({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="table-row-marker"
      data-active={active ? 'true' : undefined}
      className={cn(
        'h-4 shrink-0 rounded-full bg-primary transition-[width,margin-right,opacity] duration-300 ease-out motion-reduce:transition-none',
        active ? 'mr-2 w-0.5 opacity-100' : 'mr-0 w-0 opacity-0',
        className,
      )}
    />
  )
}

/**
 * A caption for the table. Rendered as a sibling of `role="table"` — a table may
 * only own row/rowgroup children, so descriptive copy parked inside it is
 * invalid ARIA.
 */
export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="table-caption"
      className={cn('mt-2 text-sm text-muted-foreground', className)}
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
 * affordance, the emphasis and the keyboard behaviour are identical everywhere.
 *
 * It deliberately has no box — no fill, border or padding of its own — so the
 * label sits exactly where the cell padding puts it and stays flush with the
 * column of values beneath it. State is carried by ink: the label goes to full
 * `foreground` when its column is the active sort, and only the active
 * direction's arrow takes the interactive accent. An inactive column keeps a
 * placeholder pair at the faintest ink in the ramp — present enough to say "this
 * sorts", quiet enough that a row of them does not compete with the labels.
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
