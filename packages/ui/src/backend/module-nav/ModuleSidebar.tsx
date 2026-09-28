"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../../primitives/button'
import { Dropdown, type DropdownAction } from '../../primitives/dropdown'
import { IconButton } from '../../primitives/icon-button'

/**
 * The module sidebar family: the Task Manager's in-page navigation, made
 * reusable so every module's sidebar is built from the same parts and cannot
 * drift from it. The page list most modules get from `BackendModuleFrame`, and
 * a module that draws its own (Tasks), are composed only from these parts, so
 * every sidebar shares one type, one row and one selection. On a phone the
 * sidebar is a horizontal strip above the page; from `md` up it is a sticky
 * column beside it.
 *
 * Rows follow Apple's sidebars: the label in primary ink, the icon in the
 * accent colour, a count in the secondary label, and the selected row on a
 * grey fill.
 *
 * The parts also build a rail that is not a module sidebar (Chat's list of
 * conversations): outside `ModuleSidebar` they stay a plain column on a phone,
 * where inside it they fold into the strip.
 *
 * `--module-sidebar-top` / `--module-sidebar-max-height` pin the column under
 * the topbar on pages that scroll the document. Viewport-locked pages
 * (`<Page fill>`) scroll inside `main` instead, so `globals.css` resets both
 * there — otherwise the column would sit a topbar's height below its row.
 */

const ITEM =
  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:shadow-focus'
const ITEM_ACTIVE = 'bg-primary-soft text-primary'
const ITEM_IDLE = 'text-foreground hover:bg-surface-muted'
const SECTION_LABEL = 'shrink-0 truncate px-3 pb-1 pt-1 text-xs font-semibold text-muted-foreground'
const ACTION = 'h-auto justify-start border-0 font-semibold text-primary hover:bg-primary-soft hover:text-primary [&_svg]:size-4'

/** Sidebar column beside the page; one row above it on a phone. */
export const MODULE_LAYOUT =
  'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 text-foreground md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-1 md:gap-8'
/** The column narrowed to its icons, for a sidebar that can collapse. */
const MODULE_LAYOUT_COLLAPSED = 'md:grid-cols-[3.5rem_minmax(0,1fr)]'

/**
 * Where the parts sit: `strip` inside a `ModuleSidebar`, which is a horizontal
 * strip on a phone (so labels and notes hide there), and `collapsed` when that
 * sidebar is narrowed to its icons (from `md` up).
 */
const ModuleSidebarContext = React.createContext<{ collapsed: boolean; strip: boolean }>({ collapsed: false, strip: false })

const STICKY_STYLE: React.CSSProperties = {
  top: 'var(--module-sidebar-top, calc(var(--topbar-height, 4rem) + 1rem))',
  maxHeight: 'var(--module-sidebar-max-height, calc(100svh - var(--topbar-height, 4rem) - 2rem))',
}

export function ModuleLayout({
  sidebar,
  collapsed = false,
  children,
}: {
  sidebar: React.ReactNode
  collapsed?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn(MODULE_LAYOUT, collapsed && MODULE_LAYOUT_COLLAPSED)} data-module-layout="">
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
    </div>
  )
}

/**
 * `onToggleCollapse` makes the sidebar collapsible: a button beside the title
 * narrows it to its icons (pair it with `ModuleLayout`'s `collapsed`). Without
 * it the sidebar is fixed, as most modules' are.
 */
export function ModuleSidebar({
  label,
  title,
  collapsed = false,
  onToggleCollapse,
  toggleLabels,
  children,
  ...rest
}: {
  label: string
  title?: string
  collapsed?: boolean
  onToggleCollapse?: () => void
  toggleLabels?: { collapse: string; expand: string }
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'>) {
  const navRef = React.useRef<HTMLElement>(null)
  const pathname = usePathname()
  const context = React.useMemo(() => ({ collapsed, strip: true }), [collapsed])
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
        className="flex items-center gap-1 overflow-x-auto rounded-xl p-2 md:min-h-0 md:flex-col md:items-stretch md:gap-1 md:overflow-y-auto md:overflow-x-hidden"
      >
        {onToggleCollapse ? (
          <div className={cn('hidden shrink-0 items-center gap-1 pb-1 md:flex', collapsed ? 'justify-center' : 'justify-between')}>
            {title && !collapsed ? (
              <p className="truncate px-3 pt-1 text-sm font-semibold text-foreground">{title}</p>
            ) : null}
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              title={collapsed ? toggleLabels?.expand : toggleLabels?.collapse}
              aria-label={collapsed ? toggleLabels?.expand : toggleLabels?.collapse}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
            </IconButton>
          </div>
        ) : title ? (
          <p className="hidden shrink-0 truncate px-3 pb-2 pt-1 text-sm font-semibold text-foreground md:block">
            {title}
          </p>
        ) : null}
        <ModuleSidebarContext.Provider value={context}>{children}</ModuleSidebarContext.Provider>
      </nav>
    </aside>
  )
}

/**
 * One row. `icon` sits in the 16px accent slot; `leading` takes the slot's
 * place for something that is not a glyph (a person's avatar), and `trailing`
 * takes the count's place (an unread dot). `emphasized` sets the label in
 * semibold, for a row that is waiting on the reader.
 */
export function ModuleSidebarLink({
  href,
  icon,
  leading,
  label,
  active,
  count,
  trailing,
  emphasized = false,
  depth = 0,
  disabled = false,
  ...rest
}: {
  href: string
  icon?: React.ReactNode
  leading?: React.ReactNode
  label: React.ReactNode
  active: boolean
  count?: number
  trailing?: React.ReactNode
  emphasized?: boolean
  depth?: 0 | 1
  disabled?: boolean
} & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'href' | 'className' | 'children'>) {
  const { collapsed } = React.useContext(ModuleSidebarContext)
  const content = (
    <>
      {leading ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {leading}
        </span>
      ) : icon ? (
        <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-primary [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'md:sr-only')}>{label}</span>
      {trailing ? (
        <span className={cn('flex shrink-0 items-center', collapsed && 'md:hidden')}>{trailing}</span>
      ) : count ? (
        <span className={cn('text-xs tabular-nums text-muted-foreground', collapsed && 'md:hidden')}>{count}</span>
      ) : null}
    </>
  )
  const className = cn(
    ITEM,
    depth === 1 && 'py-1.5 md:pl-9',
    collapsed && 'md:justify-center md:px-0',
    active ? ITEM_ACTIVE : ITEM_IDLE,
    emphasized && 'font-semibold',
  )
  const tooltip = collapsed && typeof label === 'string' ? label : undefined
  if (disabled) {
    return (
      <span aria-disabled="true" title={tooltip} className={cn(className, 'pointer-events-none opacity-50')}>
        {content}
      </span>
    )
  }
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} title={tooltip} className={className} {...rest}>
      {content}
    </Link>
  )
}

/**
 * The primary create action at the head of a sidebar, in the accent colour.
 * With `menuItems` it opens a short menu instead (a new chat can be a direct
 * message or a space), so a rail keeps one create control however many kinds
 * of thing it can start.
 */
export function ModuleSidebarAction({
  icon,
  label,
  onClick,
  menuItems,
  'data-testid': testId,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  menuItems?: DropdownAction[]
  'data-testid'?: string
}) {
  const { collapsed } = React.useContext(ModuleSidebarContext)
  const className = cn(ITEM, ACTION, collapsed && 'md:justify-center md:px-0')
  if (menuItems) {
    return (
      <Dropdown
        menu
        align="start"
        variant="ghost"
        data-testid={testId}
        placeholder={label}
        triggerLeading={<span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">{icon}</span>}
        triggerLabel={<span className={cn(collapsed && 'md:sr-only')}>{label}</span>}
        triggerClassName={cn(className, 'w-full')}
        actions={menuItems}
      />
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      title={collapsed ? label : undefined}
      data-testid={testId}
      className={className}
    >
      {icon}
      <span className={cn(collapsed && 'md:sr-only')}>{label}</span>
    </Button>
  )
}

export function ModuleSidebarDivider() {
  const { strip } = React.useContext(ModuleSidebarContext)
  return <hr aria-hidden="true" className={cn('shrink-0 border-t border-border', strip ? 'hidden md:my-2 md:block' : 'my-2')} />
}

export function ModuleSidebarSectionLabel({ children }: { children: React.ReactNode }) {
  const { collapsed, strip } = React.useContext(ModuleSidebarContext)
  if (collapsed) return null
  return <p className={cn(strip && 'hidden md:block', SECTION_LABEL)}>{children}</p>
}

/** A quiet note in the sidebar's column: an empty list's title and hint. */
export function ModuleSidebarNote({ title, description }: { title: string; description?: string }) {
  const { collapsed, strip } = React.useContext(ModuleSidebarContext)
  if (collapsed) return null
  return (
    <div className={cn('shrink-0 space-y-0.5 px-3 py-1 text-xs text-muted-foreground', strip && 'hidden md:block')}>
      <p className="font-medium">{title}</p>
      {description ? <p>{description}</p> : null}
    </div>
  )
}

const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-24'] as const

/** A row's placeholder on the row's own box; `avatar` for rows that lead with one. */
export function ModuleSidebarSkeletonRow({ width, avatar = false }: { width: string; avatar?: boolean }) {
  return (
    <span aria-hidden="true" className={cn(ITEM, 'text-transparent')}>
      <span
        className={cn(
          'shrink-0 animate-pulse bg-surface-strong motion-reduce:animate-none',
          avatar ? 'size-5 rounded-full' : 'size-4 rounded',
        )}
      />
      <span className={cn('h-3 animate-pulse rounded bg-surface-strong motion-reduce:animate-none', width)} />
    </span>
  )
}

/**
 * A titled group of links whose content a module loads itself, such as the
 * Task Manager's projects or Chat's direct messages. The label can lead to the
 * group's own page; a `badge` (an unread total) and one `action` (a + that
 * creates an item) sit at its end. While `loading`, it holds rows on the link's
 * own box; with no links it shows `empty` as a quiet note. `landmark` names the
 * links as their own navigation region. Inside a module sidebar the label hides
 * on a phone unless it is a link, like every section label.
 */
export function ModuleSidebarSection({
  label,
  href,
  badge,
  action,
  loading = false,
  empty,
  landmark = false,
  children,
}: {
  label: string
  href?: string
  badge?: React.ReactNode
  action?: { icon: React.ReactNode; label: string; onClick: () => void }
  loading?: boolean
  empty?: { title: string; description?: string }
  landmark?: boolean
  children?: React.ReactNode
}) {
  const { collapsed, strip } = React.useContext(ModuleSidebarContext)
  const hasItems = React.Children.toArray(children).length > 0
  return (
    <>
      <div className={cn('flex shrink-0 items-center gap-1', collapsed && 'md:hidden', strip && !href && !action && 'hidden md:flex')}>
        {href ? (
          <Link
            href={href}
            className={cn(SECTION_LABEL, 'flex-1 rounded-md transition-colors hover:text-foreground focus:outline-none focus-visible:shadow-focus')}
          >
            {label}
          </Link>
        ) : (
          <p className={cn(strip && 'hidden md:block', 'flex-1', SECTION_LABEL)}>{label}</p>
        )}
        {badge ? <span className="px-3 text-xs font-semibold tabular-nums text-primary">{badge}</span> : null}
        {action ? (
          <IconButton type="button" variant="ghost" size="xs" onClick={action.onClick} aria-label={action.label}>
            {action.icon}
          </IconButton>
        ) : null}
      </div>
      {loading ? (
        <>
          <ModuleSidebarSkeletonRow width={SKELETON_WIDTHS[0]} />
          <ModuleSidebarSkeletonRow width={SKELETON_WIDTHS[1]} />
        </>
      ) : hasItems ? (
        landmark ? (
          <nav aria-label={label} className="contents">
            {children}
          </nav>
        ) : (
          children
        )
      ) : empty ? (
        <ModuleSidebarNote title={empty.title} description={empty.description} />
      ) : null}
    </>
  )
}

/** Loading placeholder on the same row box as a real link, so nothing moves when the nav lands. */
export function ModuleSidebarSkeleton({ label }: { label: string }) {
  return (
    <aside className="min-w-0 md:sticky md:self-start" style={STICKY_STYLE}>
      <div
        role="status"
        aria-busy="true"
        aria-label={label}
        className="flex items-center gap-1 overflow-hidden rounded-xl p-2 md:flex-col md:items-stretch"
      >
        <span aria-hidden="true" className="hidden px-3 pb-1 pt-2 md:block">
          <span className="block h-3 w-20 animate-pulse rounded bg-surface-strong motion-reduce:animate-none" />
        </span>
        {SKELETON_WIDTHS.map((width, index) => (
          <ModuleSidebarSkeletonRow key={index} width={width} />
        ))}
      </div>
    </aside>
  )
}
