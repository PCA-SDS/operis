"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SKELETON_BAR_CLASS } from '../../primitives/skeleton'
import { Spinner } from '../../primitives/spinner'
import {
  TABLE_ICON_COLUMN_WIDTH,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../primitives/table'
import { PAGE_TITLE_CLASS } from '../Page'
import {
  FORM_COLUMNS,
  FORM_FIELD_GRID_CONTAINER,
  FORM_FIELD_GRID_SPLIT,
  FORM_FIELD_LABEL,
  FORM_FIELD_SPAN,
  FORM_SECTION,
  FORM_SECTION_HEADER,
  FORM_SECTION_PANEL,
  FORM_SECTION_STACK,
  FORM_SECTION_TITLE,
} from '../forms/formChrome'

/**
 * Page skeletons that are the page they stand in for, drawn in placeholder
 * bars: the same frames, cards, paddings, row heights and control heights, so
 * when the real content lands the page keeps its shape and the placeholders
 * become words. They are built from the components and class constants the real pages
 * use (`Table`, the form chrome, `PAGE_TITLE_CLASS`) rather than copies of
 * their numbers, so a change to the page moves its skeleton with it.
 *
 * A text line keeps its line box: a bar sits inside a box as tall as the text
 * it replaces (`flex h-5 items-center` for 14px text, the title class itself
 * for a title), because a bar the height of the glyphs makes every row a few
 * pixels shorter and the page grows when the words arrive.
 */

/** One decorative placeholder; the skeleton around it owns the live region. */
export function SkeletonBar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={cn('block shrink-0', SKELETON_BAR_CLASS, className)} style={style} />
}

/** The single status region a whole skeleton announces through. */
export function SkeletonRegion({
  className,
  label,
  children,
}: {
  className?: string
  label?: string
  children: React.ReactNode
}) {
  const t = useT()
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-slot="page-skeleton" className={className}>
      <span className="sr-only">{label ?? t('ui.dataLoader.loading', 'Loading...')}</span>
      {children}
    </div>
  )
}

/** A title line: the real title class, so the line box is the title's own. */
function TitleLine({ className, barClassName }: { className: string; barClassName: string }) {
  return (
    <div className={cn(className, 'flex items-center')}>
      <span aria-hidden="true">&#8203;</span>
      <SkeletonBar className={barClassName} />
    </div>
  )
}

/** A line of 14px text, held at its 20px line box. */
function TextLine({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className="flex h-5 items-center">
      <SkeletonBar className={cn('h-3.5', className)} />
    </span>
  )
}

/** Rows a list skeleton draws; `DataTable`'s first-load rows use the same count. */
export const LIST_SKELETON_ROW_COUNT = 6
const LIST_COLUMN_BARS = [
  ['w-32', 'w-40', 'w-28', 'w-36', 'w-24', 'w-32'],
  ['w-44', 'w-36', 'w-48', 'w-40', 'w-44', 'w-32'],
  ['w-16', 'w-20', 'w-16', 'w-24', 'w-20', 'w-16'],
  ['w-20', 'w-24', 'w-28', 'w-20', 'w-24', 'w-28'],
] as const

/**
 * A `DataTable` list page: the title row with its actions, and the card holding
 * the toolbar and the rows. Rows are 65px, the height the 32px row-actions
 * button gives every real row. No pager: the table draws none until it knows
 * the total, so the real one arrives below everything rather than replacing a
 * placeholder.
 */
export function ListPageSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-h-9 min-w-0 items-end">
              <TitleLine className={PAGE_TITLE_CLASS} barClassName="h-7 w-44" />
            </div>
          </div>
          <div className="flex min-h-9 flex-wrap items-center gap-2">
            <SkeletonBar className="size-9 rounded-lg" />
            <SkeletonBar className="size-9 rounded-lg" />
            <SkeletonBar className="h-9 w-18 rounded-lg" />
            <SkeletonBar className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-card-edge bg-surface shadow-sm">
        {/* The toolbar's two groups, wrapping where the real ones do: the
            search with the trigger beside it, then the filter and view
            controls, which drop to a second line on a phone. */}
        <div className="px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <SkeletonBar className="h-9 w-52 rounded-lg sm:w-72 lg:w-80" />
              <SkeletonBar className="h-9 w-16 rounded-lg" />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <SkeletonBar className="h-9 w-24 rounded-lg" />
              <SkeletonBar className="h-9 w-20 rounded-lg" />
              <SkeletonBar className="h-9 w-24 rounded-lg" />
            </div>
          </div>
        </div>
        <Table
          columns={['3.5rem', 'minmax(0,1.4fr)', 'minmax(0,1.6fr)', 'minmax(0,1fr)', 'minmax(0,1fr)', TABLE_ICON_COLUMN_WIDTH]}
        >
          <TableHeader>
            <TableRow>
              <TableHead padding="control">
                <SkeletonBar className="size-4 rounded-sm" />
              </TableHead>
              {LIST_COLUMN_BARS.map((_, index) => (
                <TableHead key={index}>
                  <span aria-hidden="true" className="flex h-4 items-center">
                    <SkeletonBar className="h-3 w-16" />
                  </span>
                </TableHead>
              ))}
              <TableHead padding="control" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: LIST_SKELETON_ROW_COUNT }, (_, rowIndex) => (
              <TableRow key={rowIndex}>
                <TableCell padding="control">
                  <SkeletonBar className="size-4 rounded-sm" />
                </TableCell>
                {LIST_COLUMN_BARS.map((widths, columnIndex) => (
                  <TableCell key={columnIndex}>
                    <TextLine className={widths[rowIndex % widths.length]} />
                  </TableCell>
                ))}
                <TableCell padding="control" align="right">
                  <SkeletonBar className="size-8 rounded-lg" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SkeletonRegion>
  )
}

export type FormSkeletonField = {
  /** The field's share of a split grid's six tracks; none in a plain grid. */
  span?: 'full' | 'half' | 'third'
  /**
   * The control's shape: a 36px box (the default, which covers every input,
   * select, picker and combobox), a textarea of `rows`, a checkbox beside its
   * label, or a rich-text editor.
   */
  control?: 'input' | 'textarea' | 'checkbox' | 'editor'
  rows?: number
  /**
   * The field's label. Given, it is set as text, so the skeleton's labels are
   * the form's own and wrap where they will; omitted, a bar stands in for it;
   * empty, the field has none.
   */
  label?: string
  /** Whether a line of help sits under the control. */
  hint?: boolean
}

export type FormSkeletonSection = {
  /** The section's title: text when known, a bar when not, and no header at all for `null`. */
  title?: string | null
  description?: string
  /**
   * A module's own component in the panel, whose shape is unknown: one 80px
   * block, the height of the custom-fields empty state it most often is.
   */
  block?: boolean
  /** Draw the filled panel (default); `false` lays the fields flat, as an embedded form does. */
  panel?: boolean
  /** The field grid's class, when it is not the split grid. */
  grid?: string
  fields: FormSkeletonField[]
}

/** A textarea's height: its rows of 20px lines, its padding and border, never under `min-h-20`. */
function textareaHeight(rows: number | undefined): number {
  return Math.max(80, (rows ?? 2) * 20 + 18)
}

/**
 * Bars on a section panel. The panel is `surface-muted`, the default bar's own
 * fill, so text bars go a step darker and fields take the white tile the
 * section's real controls are.
 */
const PANEL_TONE = { text: 'bg-surface-strong', field: 'bg-surface' } as const
const FLAT_TONE = { text: '', field: '' } as const

function FormSkeletonFieldBlock({
  field,
  index,
  tone,
}: {
  field: FormSkeletonField
  index: number
  tone: { text: string; field: string }
}) {
  const control = field.control ?? 'input'
  const labelWidth = index % 2 === 0 ? 'w-24' : 'w-32'
  if (control === 'checkbox') {
    return (
      <div aria-hidden="true" className="flex h-5 items-center gap-2">
        <SkeletonBar className={cn('size-4 rounded-sm', tone.field)} />
        {field.label === undefined ? (
          <SkeletonBar className={cn('h-3.5', labelWidth, tone.text)} />
        ) : (
          <span className="text-sm">{field.label}</span>
        )}
      </div>
    )
  }
  const fieldClass = cn('w-full rounded-lg', tone.field)
  return (
    <>
      {field.label === undefined ? (
        <span aria-hidden="true" className="mb-2 flex h-5 items-center">
          <SkeletonBar className={cn('h-3.5', labelWidth, tone.text)} />
        </span>
      ) : field.label.trim().length > 0 ? (
        <span aria-hidden="true" className={FORM_FIELD_LABEL}>
          {field.label}
        </span>
      ) : null}
      {control === 'textarea' ? (
        <SkeletonBar className={fieldClass} style={{ height: textareaHeight(field.rows) }} />
      ) : control === 'editor' ? (
        <SkeletonBar className={cn('h-40', fieldClass)} />
      ) : (
        <SkeletonBar className={cn('h-9', fieldClass)} />
      )}
      {field.hint ? (
        <span aria-hidden="true" className="mt-1.5 flex h-4.5 items-center">
          <SkeletonBar className={cn('h-3 w-48 max-w-full', tone.text)} />
        </span>
      ) : null}
    </>
  )
}

function FormSkeletonSectionBlock({ section }: { section: FormSkeletonSection }) {
  const panel = section.panel !== false
  const tone = panel ? PANEL_TONE : FLAT_TONE
  const body = (
    <>
      {section.description ? (
        <p aria-hidden="true" className="text-sm text-muted-foreground">{section.description}</p>
      ) : null}
      {section.block ? <SkeletonBar className={cn('h-20 w-full rounded-lg', tone.field)} /> : null}
      {section.fields.length > 0 ? (
        <div className={FORM_FIELD_GRID_CONTAINER}>
          <div className={section.grid ?? FORM_FIELD_GRID_SPLIT}>
            {section.fields.map((field, index) => (
              <div key={index} className={field.span ? FORM_FIELD_SPAN[field.span] : undefined}>
                <FormSkeletonFieldBlock field={field} index={index} tone={tone} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
  return (
    <section className={FORM_SECTION}>
      {section.title === null ? null : (
        <header className={cn(FORM_SECTION_HEADER, 'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between')}>
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="min-w-0">
              {section.title ? (
                <p aria-hidden="true" className={FORM_SECTION_TITLE}>{section.title}</p>
              ) : (
                <TitleLine className={FORM_SECTION_TITLE} barClassName="h-6 w-40" />
              )}
            </div>
          </div>
        </header>
      )}
      {panel ? <div className={FORM_SECTION_PANEL}>{body}</div> : body}
    </section>
  )
}

/**
 * A `CrudForm` body: its two columns of titled sections, each a panel of label
 * and field pairs laid out on the same grid, spans and gaps as the real form.
 * `CrudForm` describes its own groups and fields, so its section titles and
 * labels are the real words and only the values are placeholders.
 */
export function FormBodySkeleton({ columns }: { columns: FormSkeletonSection[][] }) {
  const populated = columns.filter((column) => column.length > 0)
  return (
    <div className={populated.length > 1 ? FORM_COLUMNS : 'grid grid-cols-1 gap-8'}>
      {populated.map((column, columnIndex) => (
        <div key={columnIndex} className={FORM_SECTION_STACK}>
          {column.map((section, sectionIndex) => (
            <FormSkeletonSectionBlock key={sectionIndex} section={section} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** The buttons a form's footer carries, so its skeleton draws the same row. */
export type FormSkeletonFooter = { embedded?: boolean; withDelete?: boolean; withCancel?: boolean }

function FormSkeletonContent({
  columns,
  footer,
}: {
  columns: FormSkeletonSection[][]
  footer?: FormSkeletonFooter | null
}) {
  return (
    <>
      <FormBodySkeleton columns={columns} />
      {footer ? (
        <div className={cn('flex items-center gap-2', footer.embedded ? 'justify-end' : 'justify-between')}>
          {footer.embedded ? null : <div />}
          <div className="flex items-center gap-2">
            {footer.withDelete ? <SkeletonBar className="h-9 w-24 rounded-lg" /> : null}
            {footer.withCancel ? <SkeletonBar className="h-9 w-20 rounded-lg" /> : null}
            <SkeletonBar className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      ) : null}
    </>
  )
}

/**
 * A `CrudForm` while its record loads: the body, then the footer row, in the
 * form's own stack (`className` is the form's spacing). The form's header
 * stays live above it.
 */
export function FormSkeleton({
  columns,
  footer,
  className,
  label,
}: {
  columns: FormSkeletonSection[][]
  footer?: FormSkeletonFooter | null
  className?: string
  /** What the region announces; the form's own loading message. */
  label?: string
}) {
  return (
    <SkeletonRegion className={className} label={label}>
      <FormSkeletonContent columns={columns} footer={footer} />
    </SkeletonRegion>
  )
}

const DEFAULT_FORM_COLUMNS: FormSkeletonSection[][] = [
  [
    {
      fields: [
        { span: 'full' },
        { span: 'half' },
        { span: 'half' },
        { span: 'third' },
        { span: 'third' },
        { span: 'third' },
      ],
    },
    { fields: [{ span: 'half' }, { span: 'half' }, { span: 'half' }, { span: 'half' }] },
  ],
  [
    { fields: [{ span: 'full' }, { span: 'full' }, { span: 'full' }] },
    { fields: [{ span: 'full', control: 'textarea' }] },
  ],
]

/**
 * A create or edit page: the form header with its actions, then the form body
 * and its footer. The route does not know the form yet, so the sections are a
 * typical form's.
 */
export function FormPageSkeleton() {
  return (
    <SkeletonRegion className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center gap-3">
          <TextLine className="w-12" />
          <span aria-hidden="true" className="flex h-6 items-center">
            <SkeletonBar className="h-4 w-36" />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBar className="h-9 w-20 rounded-lg" />
          <SkeletonBar className="h-9 w-36 rounded-lg" />
        </div>
      </div>
      <div className="space-y-5">
        <FormSkeletonContent columns={DEFAULT_FORM_COLUMNS} footer={{ withCancel: true }} />
      </div>
    </SkeletonRegion>
  )
}

/**
 * A record's detail page: the header card (avatar, name, meta lines, tags and
 * actions), then the section rail beside the tab strip and the active tab's
 * card, on the geometry of the customer detail pages.
 */
export function DetailPageSkeleton({ label }: { label?: string } = {}) {
  return (
    <SkeletonRegion className="space-y-4" label={label}>
      <div className="rounded-xl border border-card-edge bg-surface px-6 py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <SkeletonBar className="size-16 rounded-full" />
          <div className="min-w-0 flex-1">
            <span aria-hidden="true" className="flex h-8 items-center">
              <SkeletonBar className="h-6 w-48" />
            </span>
            <div className="mt-0.5">
              <TextLine className="w-72 max-w-full" />
            </div>
            <div className="mt-1.5 flex items-center gap-5">
              <TextLine className="w-32" />
              <TextLine className="w-52" />
            </div>
            <span aria-hidden="true" className="mt-1.5 flex h-6 items-center">
              <SkeletonBar className="h-3.5 w-60" />
            </span>
            <div className="mt-2.5 flex h-9 flex-wrap items-center gap-2">
              <SkeletonBar className="h-5 w-18 rounded-full" />
              <SkeletonBar className="h-5 w-24 rounded-full" />
              <SkeletonBar className="h-5 w-32 rounded-full" />
              <SkeletonBar className="h-9 w-28 rounded-lg" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SkeletonBar className="size-9 rounded-lg" />
            <SkeletonBar className="size-9 rounded-lg" />
            <SkeletonBar className="size-9 rounded-lg" />
            <SkeletonBar className="h-9 w-16 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="hidden shrink-0 flex-col items-center gap-3 lg:flex">
          <SkeletonBar className="size-9 rounded-lg" />
          <div className="flex flex-col items-center gap-2">
            <SkeletonBar className="size-9 rounded-lg" />
            <SkeletonBar className="size-9 rounded-lg" />
            <SkeletonBar className="size-9 rounded-lg" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-10 items-end gap-6 border-b border-border pb-3">
            {['w-20', 'w-16', 'w-24', 'w-20', 'w-14', 'w-24', 'w-12'].map((width, index) => (
              <SkeletonBar key={index} className={cn('h-3.5', width)} />
            ))}
          </div>
          <div className="pt-6">
            <div className="space-y-4 rounded-xl border border-card-edge bg-surface p-5 shadow-sm">
              <span aria-hidden="true" className="flex h-6 items-center">
                <SkeletonBar className="h-4 w-40" />
              </span>
              {['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-3/4'].map((width, index) => (
                <TextLine key={index} className={width} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/**
 * A widget's body while its module loads: rows of a line and a caption, the
 * shape most widgets list. `DashboardScreen` draws it in each real card, and
 * the dashboard skeleton in each placeholder card, so the two match.
 */
export function DashboardWidgetBodySkeleton() {
  return (
    <div aria-hidden="true" className="space-y-5">
      {Array.from({ length: 4 }, (_, rowIndex) => (
        <div key={rowIndex} className="space-y-1.5">
          <TextLine className={rowIndex % 2 === 0 ? 'w-40' : 'w-32'} />
          <SkeletonBar className="h-3 w-20" />
        </div>
      ))}
    </div>
  )
}

/**
 * The dashboard: its greeting and subtitle, the Customize button, and a row of
 * widget cards. A card's description is drawn over two lines, the length a
 * widget's sentence runs to in a third of the row.
 */
export function DashboardSkeleton() {
  return (
    <SkeletonRegion className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <TitleLine className="text-2xl font-semibold tracking-tight" barClassName="h-6 w-96 max-w-full" />
          <TextLine className="w-80 max-w-full" />
        </div>
        <SkeletonBar className="h-8 w-28.5 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, cardIndex) => (
          <div key={cardIndex} className="flex flex-col rounded-xl border border-card-edge bg-surface shadow-sm">
            <div className="px-4 pt-3">
              <span aria-hidden="true" className="flex h-3.5 items-center">
                <SkeletonBar className="h-3 w-32" />
              </span>
              <span aria-hidden="true" className="mt-1 flex h-4 items-center">
                <SkeletonBar className="h-3 w-full" />
              </span>
              <span aria-hidden="true" className="flex h-4 items-center">
                <SkeletonBar className="h-3 w-40 max-w-full" />
              </span>
            </div>
            <div className="flex-1 px-4 pb-4 pt-3">
              <DashboardWidgetBodySkeleton />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/**
 * The loading state for a page whose layout the route does not know: nothing
 * for a moment, then a small spinner in the middle of the content area. A
 * skeleton here would guess at a shape, and a wrong shape is the jump this
 * exists to avoid. The delay keeps a quick navigation from flashing it.
 */
export function PageLoadingIndicator({ delayMs = 400 }: { delayMs?: number }) {
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs])
  return (
    <div data-slot="page-loading" className="flex min-h-80 flex-1 items-center justify-center">
      {visible ? <Spinner size="md" /> : null}
    </div>
  )
}
