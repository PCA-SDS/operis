import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Page frame.
 *
 * One vertical rhythm declared on the parent (`space-y-5`) rather than an
 * `mt-*` chain on each child: spacing becomes one decision, every new block
 * inherits it, and a conditionally-rendered section can't silently lose its
 * margin.
 *
 * `fill` opts a page into the viewport-locked model — the shell scrolls, the
 * page does not. The header becomes `shrink-0` and the body is handed the
 * leftover height, so a list page can give that height to its table and keep
 * the toolbar, column headers and pagination on screen while rows scroll. Pass
 * a breakpoint (`sm` / `md` / `lg`) to only lock in from that width up, so
 * narrow viewports keep natural document scrolling.
 *
 * Pages that don't opt in behave exactly as before — `fill` is additive.
 */
export type PageFill = boolean | 'sm' | 'md' | 'lg'

const FILL_WRAPPER: Record<string, string> = {
  true: 'flex h-full min-h-0 flex-col gap-5',
  sm: 'space-y-5 sm:flex sm:h-full sm:min-h-0 sm:flex-col sm:gap-5 sm:space-y-0',
  md: 'space-y-5 md:flex md:h-full md:min-h-0 md:flex-col md:gap-5 md:space-y-0',
  lg: 'space-y-5 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-5 lg:space-y-0',
}

const FILL_BODY: Record<string, string> = {
  true: 'flex min-h-0 flex-1 flex-col',
  sm: 'sm:flex sm:min-h-0 sm:flex-1 sm:flex-col',
  md: 'md:flex md:min-h-0 md:flex-1 md:flex-col',
  lg: 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col',
}

const FILL_HEADER: Record<string, string> = {
  true: 'shrink-0',
  sm: 'sm:shrink-0',
  md: 'md:shrink-0',
  lg: 'lg:shrink-0',
}

function fillKey(fill: PageFill | undefined): string | null {
  if (!fill) return null
  return fill === true ? 'true' : fill
}

export function Page({
  children,
  className,
  fill,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { fill?: PageFill }) {
  const key = fillKey(fill)
  return (
    <div
      data-slot="page"
      data-fill={key ?? undefined}
      className={cn(key ? FILL_WRAPPER[key] : 'space-y-5', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * Page header.
 *
 * The title is large and LIGHT (`font-normal`). Weight in this product is
 * spent on things that get scanned — table column headers, tabs, nav rows —
 * not on a heading that already has size carrying it. Title and actions are
 * baseline-aligned (`items-end`) so the primary action sits on the same line
 * as the title rather than floating above a two-line description.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  fill,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** Small label above the title — section context, greeting, or record type. */
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  /** Match the host `Page`'s `fill` so the header stays pinned. */
  fill?: PageFill
  className?: string
}) {
  const key = fillKey(fill)
  return (
    <header
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4',
        key ? FILL_HEADER[key] : '',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-normal leading-tight text-foreground sm:text-3xl">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm font-medium text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

export function PageBody({
  children,
  className,
  fill,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { fill?: PageFill }) {
  const key = fillKey(fill)
  return (
    <div
      data-slot="page-body"
      className={cn(key ? FILL_BODY[key] : 'space-y-4', className)}
      {...props}
    >
      {children}
    </div>
  )
}
