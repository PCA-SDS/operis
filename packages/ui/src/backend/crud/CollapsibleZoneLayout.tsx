'use client'
import * as React from 'react'
import { PanelLeft } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { IconButton } from '../../primitives/icon-button'
import { useSidePanelPresence } from '../../primitives/side-panel-motion'
import { useZoneCollapse } from './useZoneCollapse'

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
 * 240px rail by 16px and silently dropped the whole page to its collapsed
 * layout the moment the rail grew — zone 1 (and every control in it)
 * disappeared at 1600px. 1200 keeps ~32px of headroom; raising the rail again
 * means lowering this in the same change.
 */
const SIDE_BY_SIDE_MIN_WIDTH = 1200

export interface CollapsibleZoneLayoutProps {
  zone1: React.ReactNode
  zone2: React.ReactNode
  entityName: string
  pageType: string
  zone1DefaultWidth?: string
  errorCount?: number
  isDirty?: boolean
}

const ZoneToggleElementContext = React.createContext<React.ReactNode>(null)
const ZoneToggleClaimContext = React.createContext<(() => () => void) | null>(null)

/**
 * For a component rendered in zone 2 whose first row is a toolbar (a record's
 * tab strip): returns the layout's sidebar button to draw as that row's
 * leading item, and tells the layout not to give the button a column of its
 * own, so the content under the row spans zone 2's full width. Returns null
 * outside a `CollapsibleZoneLayout`, or where the layout draws no button.
 */
export function useZoneToggleSlot(): React.ReactNode {
  const claim = React.useContext(ZoneToggleClaimContext)
  React.useLayoutEffect(() => (claim ? claim() : undefined), [claim])
  return React.useContext(ZoneToggleElementContext)
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

/**
 * A record page's split view: the form (zone 1) as a sidebar beside the tabs
 * (zone 2), shown and hidden by one sidebar button.
 *
 * The button is the leading item of zone 2's first row, so it sits beside the
 * tabs in every state: with the form open it is the form's edge, with the form
 * hidden it is where the form went, and with the form stacked above (a narrow
 * layout) it rides with the tabs below it. It never changes shape; only its
 * label and `aria-expanded` follow the state.
 *
 * All three layouts are one tree, so the form is never remounted and nothing
 * typed into it is lost when it folds, stacks or opens.
 */
export function CollapsibleZoneLayout({
  zone1,
  zone2,
  pageType,
  zone1DefaultWidth,
}: CollapsibleZoneLayoutProps) {
  const t = useT()
  const zone1Id = React.useId()
  const { collapsed, setCollapsed, isHydrated } = useZoneCollapse(pageType)
  const canCollapse = React.useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  )
  const layoutRef = React.useRef<HTMLDivElement>(null)
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

  const folded = canCollapse && (collapsed || (!canShowSideBySide && !expandedWhileConstrained))
  const stacked = !folded && !canShowSideBySide
  const layoutMode = folded ? 'collapsed' : stacked ? 'stacked' : 'side-by-side'
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
  const zone1Presence = useSidePanelPresence(!folded)

  // How many zone-2 toolbars have taken the sidebar button into their own row.
  const [toggleClaims, setToggleClaims] = React.useState(0)
  const claimToggle = React.useCallback(() => {
    setToggleClaims((count) => count + 1)
    return () => setToggleClaims((count) => count - 1)
  }, [])

  const handleToggle = React.useCallback(() => {
    if (!canCollapse) return
    if (folded) {
      setCollapsed(false)
      setExpandedWhileConstrained(!canShowSideBySide)
      return
    }
    setExpandedWhileConstrained(false)
    setCollapsed(true)
  }, [canCollapse, canShowSideBySide, folded, setCollapsed])

  const sidebarToggle = canCollapse ? (
    <IconButton
      type="button"
      variant="soft"
      size="lg"
      onClick={handleToggle}
      aria-label={folded
        ? t('ui.zone.expand', 'Expand form panel')
        : t('ui.zone.collapse', 'Collapse form panel')}
      aria-expanded={!folded}
      aria-controls={zone1Id}
    >
      <PanelLeft className="size-4" />
    </IconButton>
  ) : null

  // Folding moves the form column's grid track between `0fr` and `1fr` on the
  // curve every side panel shares, 500ms opening and 300ms closing, while the
  // tabs take the room in step. Stacking is a different arrangement rather
  // than a fold, so it switches without motion.
  const zone1Transition = motionReady && !stacked
    ? cn('transition-[grid-template-columns] ease-panel', folded ? 'duration-300' : 'duration-500')
    : null

  return (
    <div
      ref={layoutRef}
      data-zone-layout-mode={layoutMode}
      data-persistence-hydrated={isHydrated ? 'true' : 'false'}
      aria-hidden={isHydrated ? undefined : true}
      className={cn('flex', stacked ? 'flex-col gap-4' : 'flex-col lg:flex-row', !isHydrated && 'invisible')}
    >
      <div
        id={zone1Id}
        data-zone1=""
        className={cn('grid min-w-0 shrink-0', zone1Transition)}
        style={{ gridTemplateColumns: folded ? '0fr' : '1fr' }}
        inert={folded}
        aria-hidden={folded ? true : undefined}
      >
        <div className={cn('min-w-0 overflow-hidden', zone1Presence.present ? null : 'h-0')}>
          <div className="flex h-full">
            <div
              className={cn('w-full', stacked ? null : 'lg:shrink-0')}
              style={stacked ? undefined : { width: zone1Width }}
            >
              {zone1}
            </div>
            {/* The 16px gap to the sidebar button, inside the fold so it folds too. */}
            {stacked ? null : <div aria-hidden="true" className="hidden w-4 shrink-0 lg:block" />}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 w-full lg:flex-1">
        {sidebarToggle && toggleClaims === 0 ? (
          <div data-zone-toggle="" className="shrink-0 pr-3 pt-0.5">
            {sidebarToggle}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <ZoneToggleClaimContext.Provider value={canCollapse ? claimToggle : null}>
            <ZoneToggleElementContext.Provider value={sidebarToggle}>
              {zone2}
            </ZoneToggleElementContext.Provider>
          </ZoneToggleClaimContext.Provider>
        </div>
      </div>
    </div>
  )
}
