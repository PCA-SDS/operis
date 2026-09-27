'use client'
import * as React from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { useSidePanelPresence } from '../../primitives/side-panel-motion'
import { useZoneCollapse } from './useZoneCollapse'
import type { LucideIcon } from 'lucide-react'

/**
 * Minimum measured width of THIS layout (not the viewport) before zone 1 and
 * zone 2 sit side by side.
 *
 * The budget on a 1600px desktop — the narrowest width the side-by-side detail
 * layout is meant to serve — is the viewport minus the sidebar rail and the
 * `lg:px-8` gutters `<main>` adds:
 *
 *   1600 − 272 (AppShell SIDEBAR_WIDTH) − 64 (main's 2×2rem padding) = 1264
 *
 * so the threshold has to stay under that. It was 1280, which cleared the old
 * 240px rail by 16px and silently dropped the whole page to the collapsed rail
 * the moment the rail grew — zone 1 (and every control in it) disappeared at
 * 1600px. 1200 keeps ~32px of headroom; raising the rail again means lowering
 * this in the same change.
 */
const SIDE_BY_SIDE_MIN_WIDTH = 1200

export interface ZoneSectionDescriptor {
  id: string
  icon: LucideIcon
  label: string
  targetId?: string
  ariaLabel?: string
  errorCount?: number
}

export interface CollapsibleZoneLayoutProps {
  zone1: React.ReactNode
  zone2: React.ReactNode
  entityName: string
  pageType: string
  zone1DefaultWidth?: string
  errorCount?: number
  isDirty?: boolean
  /** Section descriptors for the collapsed rail icon sidebar. When omitted the rail shows the legacy minimal view. */
  sections?: ZoneSectionDescriptor[]
  /**
   * Chrome for the collapse/expand toggles and the collapsed rail. `default`
   * keeps the outline toggles; `soft` renders them as 36px soft icon buttons
   * with no bordered rail card, matching pages built on the soft button family.
   */
  toggleTone?: 'default' | 'soft'
}

function subscribeViewport(callback: () => void) {
  const mediaQuery = window.matchMedia('(min-width: 1024px)')
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

function getViewportSnapshot() {
  return window.matchMedia('(min-width: 1024px)').matches
}

function getViewportServerSnapshot() {
  return false
}

export function CollapsibleZoneLayout({
  zone1,
  zone2,
  entityName,
  pageType,
  zone1DefaultWidth,
  errorCount = 0,
  isDirty = false,
  sections,
  toggleTone = 'default',
}: CollapsibleZoneLayoutProps) {
  const soft = toggleTone === 'soft'
  const t = useT()
  const { collapsed, setCollapsed, isHydrated } = useZoneCollapse(pageType)
  const canCollapse = React.useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  )
  const layoutRef = React.useRef<HTMLDivElement>(null)
  const expandButtonRef = React.useRef<HTMLButtonElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  const [expandedWhileConstrained, setExpandedWhileConstrained] = React.useState(false)

  React.useEffect(() => {
    const node = layoutRef.current
    if (!node) return

    const updateWidth = (nextWidth: number) => {
      setContainerWidth((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth))
    }

    const measure = () => {
      updateWidth(node.getBoundingClientRect().width || window.innerWidth)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      updateWidth(entry.contentRect.width)
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const canShowSideBySide = containerWidth >= SIDE_BY_SIDE_MIN_WIDTH

  React.useEffect(() => {
    if (canShowSideBySide) {
      setExpandedWhileConstrained(false)
    }
  }, [canShowSideBySide])

  const showCollapsedRail = canCollapse && (collapsed || (!canShowSideBySide && !expandedWhileConstrained))
  const showStackedExpanded = !showCollapsedRail && !canShowSideBySide
  const layoutMode = showCollapsedRail ? 'collapsed' : showStackedExpanded ? 'stacked' : 'side-by-side'
  // The form column's width in pixels, so its contents hold their width while
  // the column folds rather than rewrapping on every frame.
  const zone1Width = React.useMemo(() => {
    const declared = zone1DefaultWidth?.trim() ?? ''
    const pixels = Number.parseFloat(declared)
    if (declared.endsWith('px') && Number.isFinite(pixels)) return pixels
    return Math.round(containerWidth * 0.4)
  }, [containerWidth, zone1DefaultWidth])
  // A layout restored as collapsed is simply collapsed on first paint; only a
  // fold the reader asks for afterwards moves.
  const [motionReady, setMotionReady] = React.useState(false)
  React.useEffect(() => {
    if (!isHydrated) return
    const timer = window.setTimeout(() => setMotionReady(true), 50)
    return () => window.clearTimeout(timer)
  }, [isHydrated])
  // Once folded away, the form stops holding the row open, so a form taller
  // than the tabs beside it leaves no empty band under them.
  const zone1Presence = useSidePanelPresence(!showCollapsedRail)

  const handleExpand = React.useCallback(() => {
    if (!canCollapse) return
    setCollapsed(false)
    setExpandedWhileConstrained(!canShowSideBySide)
  }, [canCollapse, canShowSideBySide, setCollapsed])

  const handleSectionActivate = React.useCallback((section: ZoneSectionDescriptor) => {
    if (!canCollapse) return
    setCollapsed(false)
    setExpandedWhileConstrained(!canShowSideBySide)
    requestAnimationFrame(() => {
      const target =
        document.getElementById(section.targetId ?? `collapsible-group-wrapper-${section.id}`)
        ?? document.getElementById(`collapsible-group-${section.id}`)
      if (!target) return
      const headingButton = target.querySelector<HTMLButtonElement>('button[aria-controls]')
      // If the inner CollapsibleGroup is currently collapsed, expand it so its
      // contents become visible and tabbable for the user who just navigated here.
      if (headingButton?.getAttribute('aria-expanded') === 'false') {
        headingButton.click()
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Prefer focusing the first focusable input/textarea/select inside the
      // section so the user can start typing immediately. Skip hidden, disabled,
      // or non-interactive controls. Fall back to the section heading.
      requestAnimationFrame(() => {
        const focusables = Array.from(
          target.querySelectorAll<HTMLElement>(
            'input:not([type="hidden"]), textarea, select, [contenteditable="true"]',
          ),
        )
        const firstInput = focusables.find((el) => {
          if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false
          if (el instanceof HTMLInputElement && el.readOnly) return false
          return true
        })
        if (firstInput) {
          firstInput.focus({ preventScroll: true })
          return
        }
        headingButton?.focus({ preventScroll: true })
      })
    })
  }, [canCollapse, canShowSideBySide, setCollapsed])

  const handleCollapse = React.useCallback(() => {
    if (!canCollapse) return
    setExpandedWhileConstrained(false)
    setCollapsed(true)
    requestAnimationFrame(() => {
      expandButtonRef.current?.focus()
    })
  }, [canCollapse, setCollapsed])

  const renderCollapseToggle = (extraClassName?: string) =>
    soft ? (
      <IconButton
        type="button"
        variant="soft"
        size="lg"
        onClick={handleCollapse}
        className={extraClassName}
        aria-label={t('ui.zone.collapse', 'Collapse form panel')}
      >
        <ChevronsLeft className="size-4" />
      </IconButton>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCollapse}
        className={cn(extraClassName, 'h-auto rounded-md border bg-card px-1.5 py-2')}
        aria-label={t('ui.zone.collapse', 'Collapse form panel')}
      >
        <ChevronsLeft className="size-4" />
      </Button>
    )

  if (showStackedExpanded) {
    return (
      <div
        ref={layoutRef}
        data-zone-layout-mode={layoutMode}
        data-persistence-hydrated={isHydrated ? 'true' : 'false'}
        aria-hidden={isHydrated ? undefined : true}
        className={cn('flex flex-col gap-4', !isHydrated && 'invisible')}
      >
        <div className="w-full space-y-2">
          {canCollapse ? (
            <div className="flex justify-end">
              {renderCollapseToggle()}
            </div>
          ) : null}
          <div className="w-full">
            {zone1}
          </div>
        </div>

        <div className="min-w-0 w-full">
          {zone2}
        </div>
      </div>
    )
  }

  // Side by side and collapsed are one layout, so the fold can move: the form
  // column (zone 1 and its divider) narrows to nothing as the rail widens in,
  // and zone 2 takes the room in step. Both columns animate their grid track
  // between `0fr` and `1fr` on the curve every side panel shares, 500ms
  // opening and 300ms closing. The folded form stays mounted but inert, so
  // collapsing never discards what was typed into it.
  const railTransition = motionReady ? 'transition-[grid-template-columns,opacity] ease-panel' : null
  const zone1Transition = motionReady ? 'transition-[grid-template-columns] ease-panel' : null
  return (
    <div
      ref={layoutRef}
      data-zone-layout-mode={layoutMode}
      data-persistence-hydrated={isHydrated ? 'true' : 'false'}
      aria-hidden={isHydrated ? undefined : true}
      className={cn('flex flex-col lg:flex-row', !isHydrated && 'invisible')}
    >
      <div
        data-zone-rail=""
        className={cn(
          'hidden shrink-0 lg:grid',
          railTransition,
          // Timed by the gesture, like the form column beside it: 300ms when
          // folding the form away, 500ms when opening it, so zone 2 moves on
          // one curve rather than creeping after the fold has landed.
          showCollapsedRail ? 'opacity-100 duration-300' : 'opacity-0 duration-500',
        )}
        style={{ gridTemplateColumns: showCollapsedRail ? '1fr' : '0fr' }}
        inert={!showCollapsedRail}
        aria-hidden={showCollapsedRail ? undefined : true}
      >
        <div className="min-w-0 overflow-hidden">
          {/* `pr-4` is the 16px gap to zone 2, inside the fold so it folds too. */}
          <div className="flex flex-col items-center gap-3 pr-4">
            {soft ? (
              <IconButton
                ref={expandButtonRef}
                type="button"
                variant="primary"
                size="lg"
                onClick={handleExpand}
                aria-label={t('ui.zone.expand', 'Expand form panel')}
              >
                <ChevronsRight className="size-4" />
              </IconButton>
            ) : (
              <Button
                ref={expandButtonRef}
                type="button"
                variant="default"
                size="sm"
                onClick={handleExpand}
                className="h-auto rounded-lg px-1.5 py-2 shadow-sm"
                aria-label={t('ui.zone.expand', 'Expand form panel')}
              >
                <ChevronsRight className="size-4" />
              </Button>
            )}
            {sections?.length ? (
              <div className={soft ? 'flex flex-col items-center gap-2' : 'flex flex-col items-center gap-2 rounded-xl border border-transparent bg-card px-2 py-3 shadow-sm'}>
                {sections.map((section) => {
                  const SectionIcon = section.icon
                  const hasErrors = Boolean(section.errorCount && section.errorCount > 0)
                  return (
                    <IconButton
                      key={section.id}
                      type="button"
                      variant={soft ? 'soft' : 'ghost'}
                      size={soft ? 'lg' : 'default'}
                      onClick={() => handleSectionActivate(section)}
                      className={soft ? 'relative' : 'relative size-9 rounded-lg border border-transparent bg-muted/70 text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground'}
                      title={section.label}
                      aria-label={section.ariaLabel ?? section.label}
                    >
                      <SectionIcon className="size-4" />
                      {hasErrors ? (
                        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-destructive" />
                      ) : null}
                    </IconButton>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Zone 1 — CrudForm area — and its divider, folding as one column. */}
      <div
        data-zone1=""
        className={cn('grid shrink-0', zone1Transition, showCollapsedRail ? 'duration-300' : 'duration-500')}
        style={{ gridTemplateColumns: showCollapsedRail ? '0fr' : '1fr' }}
        inert={showCollapsedRail}
        aria-hidden={showCollapsedRail ? true : undefined}
      >
        <div className={cn('min-w-0 overflow-hidden', zone1Presence.present ? null : 'h-0')}>
          <div className="flex h-full flex-col lg:flex-row">
            <div className="w-full lg:shrink-0" style={{ width: zone1Width }}>
              {zone1}
            </div>

            {/* Divider with collapse toggle */}
            <div className="relative mx-4 hidden w-8 shrink-0 items-start justify-center pt-4 lg:flex">
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
              {renderCollapseToggle('relative z-10')}
            </div>
          </div>
        </div>
      </div>

      {/* Zone 2 — Tabs / related data area */}
      <div className="min-w-0 w-full lg:flex-1">
        {zone2}
      </div>
    </div>
  )
}
