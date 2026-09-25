"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, LayoutGrid } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../../primitives/button'
import { EmptyState } from '../../primitives/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { SearchInput } from '../../primitives/search-input'
import { useBackendNavigation } from './BackendNavigationContext'
import {
  matchesModuleQuery,
  renderNavIcon,
  resolveGroupEntryHref,
  resolveGroupKey,
  type NavGroup,
} from './model'

const GRID_COLUMNS = 3
const MAX_PAGE_RESULTS = 8
const FALLBACK_GROUP_ICON = <LayoutGrid className="size-4" aria-hidden="true" />

type ModuleEntry = { key: string; group: NavGroup; href: string }
type PageEntry = { key: string; href: string; title: string; moduleName: string }

function collectPageMatches(groups: NavGroup[], query: string): PageEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: PageEntry[] = []
  for (const group of groups) {
    for (const item of group.items) {
      for (const page of [item, ...(item.children ?? [])]) {
        if (page.hidden === true || page.enabled === false) continue
        if (!page.title.toLowerCase().includes(needle)) continue
        matches.push({ key: `${resolveGroupKey(group)}:${page.href}`, href: page.href, title: page.title, moduleName: group.name })
        if (matches.length >= MAX_PAGE_RESULTS) return matches
      }
    }
  }
  return matches
}

function focusTile(container: HTMLElement | null, index: number) {
  const tiles = container?.querySelectorAll<HTMLElement>('[data-module-tile]')
  if (!tiles || tiles.length === 0) return
  tiles[Math.max(0, Math.min(index, tiles.length - 1))]?.focus()
}

/**
 * The topbar's way into every module: a menu of the modules this person can
 * reach, each opening at its first page, where the module's own sidebar
 * takes over. The list is the server's RBAC- and entitlement-filtered nav,
 * so a module appears here only when at least one of its pages is reachable.
 */
export function ModuleSwitcher() {
  const t = useT()
  const pathname = usePathname()
  const nav = useBackendNavigation()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const gridRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }, [])

  const modules = React.useMemo<ModuleEntry[]>(() => {
    const entries: ModuleEntry[] = []
    for (const group of nav?.moduleGroups ?? []) {
      if (!matchesModuleQuery(group, query)) continue
      const href = resolveGroupEntryHref(group)
      if (href) entries.push({ key: resolveGroupKey(group), group, href })
    }
    return entries
  }, [nav?.moduleGroups, query])
  const pages = React.useMemo(() => collectPageMatches(nav?.moduleGroups ?? [], query), [nav?.moduleGroups, query])

  const isReady = nav?.isReady ?? false
  const activeKey = nav?.activeGroup ? resolveGroupKey(nav.activeGroup) : null
  const triggerLabel = nav?.mode === 'main' && nav.activeGroup ? nav.activeGroup.name : t('appShell.modules.title', 'Modules')
  const hasQuery = query.trim().length > 0
  const hasAnyModule = (nav?.moduleGroups.length ?? 0) > 0

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tiles = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-module-tile]') ?? [])
    const index = tiles.findIndex((tile) => tile === document.activeElement)
    if (index < 0) return
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: GRID_COLUMNS,
      ArrowUp: -GRID_COLUMNS,
    }
    const delta = step[event.key]
    if (delta === undefined) return
    event.preventDefault()
    if (event.key === 'ArrowUp' && index < GRID_COLUMNS) {
      gridRef.current?.closest('[data-module-switcher]')?.querySelector<HTMLInputElement>('input')?.focus()
      return
    }
    focusTile(gridRef.current, index + delta)
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusTile(gridRef.current, 0)
      return
    }
    if (event.key === 'Enter' && modules.length > 0) {
      event.preventDefault()
      gridRef.current?.querySelector<HTMLElement>('[data-module-tile]')?.click()
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="w-9 min-w-9 max-w-56 shrink gap-2 px-0 text-foreground has-[>svg]:px-0 xl:w-auto xl:px-2.5 xl:has-[>svg]:px-2.5"
          aria-label={
            nav?.mode === 'main' && nav.activeGroup
              ? t('appShell.modules.openWithCurrent', 'Switch module, current: {module}', { module: nav.activeGroup.name })
              : t('appShell.modules.open', 'Open module menu')
          }
          data-testid="module-switcher-trigger"
        >
          <LayoutGrid className="size-4" aria-hidden="true" />
          <span className="hidden min-w-0 truncate xl:inline" data-testid="module-switcher-current">{triggerLabel}</span>
          <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground xl:inline" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0" data-module-switcher="" data-testid="module-switcher">
        <div className="border-b border-border p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('appShell.modules.searchPlaceholder', 'Search modules and pages')}
            aria-label={t('appShell.modules.searchPlaceholder', 'Search modules and pages')}
            clearLabel={t('appShell.searchNavClear', 'Clear search')}
          />
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {!isReady ? (
            <div
              role="status"
              aria-busy="true"
              aria-label={t('appShell.loadingNavigation', 'Loading navigation')}
              className="grid grid-cols-3 gap-1"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} aria-hidden="true" className="flex flex-col items-center gap-2 p-3">
                  <span className="size-5 animate-pulse rounded bg-surface-strong motion-reduce:animate-none" />
                  <span className="h-3 w-16 animate-pulse rounded bg-surface-strong motion-reduce:animate-none" />
                </span>
              ))}
            </div>
          ) : !hasAnyModule ? (
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('appShell.modules.empty', 'No modules available')}
              description={t('appShell.modules.emptyHint', 'Ask an administrator for access to a module.')}
            />
          ) : modules.length === 0 && pages.length === 0 ? (
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('appShell.modules.noResults', 'Nothing matches your search')}
            />
          ) : (
            <>
              {modules.length > 0 ? (
                <div
                  ref={gridRef}
                  role="list"
                  aria-label={t('appShell.modules.title', 'Modules')}
                  className="grid grid-cols-3 gap-1"
                  onKeyDown={handleGridKeyDown}
                >
                  {modules.map((entry) => {
                    const active = entry.key === activeKey
                    return (
                      <div role="listitem" key={entry.key} className="min-w-0">
                        <Link
                          href={entry.href}
                          data-module-tile=""
                          data-module-id={entry.key}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => handleOpenChange(false)}
                          className={cn(
                            'flex h-full flex-col items-center gap-2 rounded-lg p-3 text-center text-xs font-medium transition-colors focus:outline-none focus-visible:shadow-focus',
                            active ? 'text-primary' : 'text-foreground hover:text-primary',
                          )}
                        >
                          <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5">
                            {renderNavIcon(undefined, entry.group.iconName, entry.group.iconMarkup, FALLBACK_GROUP_ICON)}
                          </span>
                          <span className="line-clamp-2 break-words">{entry.group.name}</span>
                        </Link>
                      </div>
                    )
                  })}
                </div>
              ) : null}
              {hasQuery && pages.length > 0 ? (
                <div className={cn(modules.length > 0 && 'mt-2 border-t border-border pt-2')}>
                  <p className="px-3 pb-1 pt-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('appShell.modules.pages', 'Pages')}
                  </p>
                  <ul className="flex flex-col">
                    {pages.map((page) => (
                      <li key={page.key}>
                        <Link
                          href={page.href}
                          onClick={() => handleOpenChange(false)}
                          className="group flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:shadow-focus"
                        >
                          <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-primary">{page.title}</span>
                          <span className="shrink-0 truncate text-xs text-muted-foreground">{page.moduleName}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
