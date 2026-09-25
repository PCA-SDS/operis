"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../../primitives/button'

/**
 * The module sidebar family: the Task Manager's in-page navigation, made
 * reusable so every module's sidebar is built from the same parts and cannot
 * drift from it. On a phone the sidebar is a horizontal strip above the page;
 * from `md` up it is a sticky column beside it.
 *
 * `--module-sidebar-top` / `--module-sidebar-max-height` pin the column under
 * the topbar on pages that scroll the document. Viewport-locked pages
 * (`<Page fill>`) scroll inside `main` instead, so `globals.css` resets both
 * there — otherwise the column would sit a topbar's height below its row.
 */

const ITEM =
  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:shadow-focus'
const ITEM_ACTIVE = 'bg-primary-soft text-primary'
const ITEM_IDLE = 'text-muted-foreground hover:bg-surface-strong hover:text-foreground'

/** Sidebar column beside the page; one row above it on a phone. */
export const MODULE_LAYOUT =
  'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 text-foreground md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-1 md:gap-6'

const STICKY_STYLE: React.CSSProperties = {
  top: 'var(--module-sidebar-top, calc(var(--topbar-height, 4rem) + 1rem))',
  maxHeight: 'var(--module-sidebar-max-height, calc(100svh - var(--topbar-height, 4rem) - 2rem))',
}

export function ModuleLayout({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={MODULE_LAYOUT} data-module-layout="">
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
    </div>
  )
}

export function ModuleSidebar({
  label,
  title,
  children,
  ...rest
}: {
  label: string
  title?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'>) {
  const navRef = React.useRef<HTMLElement>(null)
  const pathname = usePathname()
  /* On a phone the nav is a horizontal strip, and the active link can start
     off-screen. Bring it into view by moving only the strip's own scroll
     position — `scrollIntoView` would also scroll the page. */
  React.useEffect(() => {
    const nav = navRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]')
    if (!active) return
    const navBox = nav.getBoundingClientRect()
    const activeBox = active.getBoundingClientRect()
    if (activeBox.left >= navBox.left && activeBox.right <= navBox.right) return
    nav.scrollLeft += activeBox.left - navBox.left - (navBox.width - activeBox.width) / 2
  }, [pathname])
  return (
    <aside aria-label={label} className="min-w-0 md:sticky md:flex md:self-start md:flex-col" style={STICKY_STYLE} {...rest}>
      <nav
        ref={navRef}
        className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-muted p-2 md:min-h-0 md:flex-col md:items-stretch md:gap-1 md:overflow-y-auto md:overflow-x-hidden"
      >
        {title ? (
          <p className="hidden truncate px-3 pb-1 pt-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground md:block">
            {title}
          </p>
        ) : null}
        {children}
      </nav>
    </aside>
  )
}

export function ModuleSidebarLink({
  href,
  icon,
  label,
  active,
  count,
  depth = 0,
  disabled = false,
  ...rest
}: {
  href: string
  icon?: React.ReactNode
  label: React.ReactNode
  active: boolean
  count?: number
  depth?: 0 | 1
  disabled?: boolean
} & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'href' | 'className' | 'children'>) {
  const content = (
    <>
      {icon ? (
        <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-xs tabular-nums opacity-70">{count}</span> : null}
    </>
  )
  const className = cn(ITEM, depth === 1 && 'py-1.5 md:pl-9', active ? ITEM_ACTIVE : ITEM_IDLE)
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(className, 'pointer-events-none opacity-50')}>
        {content}
      </span>
    )
  }
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={className} {...rest}>
      {content}
    </Link>
  )
}

export function ModuleSidebarAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(ITEM, 'h-auto justify-start border-0 font-semibold text-primary hover:bg-primary-soft hover:text-primary')}
    >
      {icon}
      {label}
    </Button>
  )
}

export function ModuleSidebarDivider() {
  return <hr aria-hidden="true" className="hidden border-t border-border md:my-2 md:block" />
}

export function ModuleSidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="hidden truncate px-3 pb-1 pt-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground md:block">
      {children}
    </p>
  )
}

const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-24'] as const

/** Loading placeholder on the same row box as a real link, so nothing moves when the nav lands. */
export function ModuleSidebarSkeleton({ label }: { label: string }) {
  return (
    <aside className="min-w-0 md:sticky md:self-start" style={STICKY_STYLE}>
      <div
        role="status"
        aria-busy="true"
        aria-label={label}
        className="flex items-center gap-1 overflow-hidden rounded-xl bg-surface-muted p-2 md:flex-col md:items-stretch"
      >
        <span aria-hidden="true" className="hidden px-3 pb-1 pt-2 md:block">
          <span className="block h-3 w-20 animate-pulse rounded bg-surface-strong motion-reduce:animate-none" />
        </span>
        {SKELETON_WIDTHS.map((width, index) => (
          <span key={index} aria-hidden="true" className={cn(ITEM, 'text-transparent')}>
            <span className="size-4 shrink-0 animate-pulse rounded bg-surface-strong motion-reduce:animate-none" />
            <span className={cn('h-3 animate-pulse rounded bg-surface-strong motion-reduce:animate-none', width)} />
          </span>
        ))}
      </div>
    </aside>
  )
}
