"use client"
import * as React from 'react'
import { createContext, useContext } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronDown, ChevronLeft, Home, Search, X } from 'lucide-react'
import { useIsomorphicLayoutEffect } from '@open-mercato/ui/hooks/useIsomorphicLayoutEffect'
import { Button } from '../primitives/button'
import {
  Breadcrumb as BreadcrumbNav,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../primitives/breadcrumb'
import { IconButton } from '../primitives/icon-button'
import { Input } from '../primitives/input'
import { SearchInput } from '../primitives/search-input'
import { Checkbox } from '../primitives/checkbox'
import { Separator } from '../primitives/separator'
import { FlashMessages } from './FlashMessages'
import { QueryProvider } from '../theme/QueryProvider'
import { usePathname, useSearchParams } from 'next/navigation'
import { apiCall } from './utils/apiCall'
import { LastOperationBanner } from './operations/LastOperationBanner'
import { RecordConflictBanner } from './conflicts/RecordConflictBanner'
import { dismissRecordConflict } from './conflicts/store'
import { ProgressTopBar } from './progress/ProgressTopBar'
import { UpgradeActionBanner } from './upgrades/UpgradeActionBanner'
import { PartialIndexBanner } from './indexes/PartialIndexBanner'
import { OrganizationScopeBoundary } from './OrganizationScopeBoundary'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { readVersionedPreference, writeVersionedPreference } from '@open-mercato/shared/lib/browser/versionedPreference'
import { cloneSidebarGroups } from './sidebar/customization-helpers'
import {
  DRAWER_CHROME_INSET,
  DRAWER_SLOT_INSET,
  SIDEBAR_BRAND_LABEL,
  SIDEBAR_CHILD_BOX,
  SIDEBAR_GROUP_DIVIDER,
  SIDEBAR_GROUP_LABEL,
  SIDEBAR_GROUP_LABEL_BOX,
  SIDEBAR_GUTTER,
  SIDEBAR_ICON_BOX,
  SIDEBAR_ITEM_BASE,
  SIDEBAR_ITEM_BOX,
  SIDEBAR_ITEM_LABEL,
  SIDEBAR_SEARCH_SIZE,
  SIDEBAR_SEARCH_TONE,
  ShellBrandLogo,
  SidebarDefaultIcon as DefaultIcon,
  shouldBypassLogoOptimization,
  sidebarItemStateClass,
  usesBuiltInWordmark,
} from './sidebar/chrome'
import type { SectionNavGroup } from './section-page/types'
import type { ShellLogo } from './sidebar/chrome'
/** Re-exported: the logo shape is part of `AppShellProps`, so callers type it from here. */
export type { ShellLogo }
import { InjectionSpot } from './injection/InjectionSpot'
import {
  BackendRecordInjectionContextProvider,
  type RecordInjectionContext,
} from './injection/recordContext'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID } from './injection/mutationEvents'
import { mergeMenuItems } from './injection/mergeMenuItems'
import { useInjectedMenuItems } from './injection/useInjectedMenuItems'
import { resolveInjectedIcon } from './injection/resolveInjectedIcon'
import { OperisLogo } from './brand/OperisLogo'
import { useEventBridge } from './injection/eventBridge'
import { StatusBadgeInjectionSpot } from './injection/StatusBadgeInjectionSpot'
import { UmesDevToolsPanel } from './devtools'
import { AiDockProvider } from '../ai/AiDock'
import { AiChatSessionsProvider } from '../ai/AiChatSessions'
import { AiAssistantLauncher } from '../ai/AiAssistantLauncher'
import { BackendChromeProvider, useBackendChrome } from './BackendChromeProvider'
import {
  BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID,
  BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID,
  BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID,
  BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID,
  GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID,
  GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID,
} from './injection/spotIds'

// Versioned-envelope discriminator for the persisted sidebar open/closed group
// map. This is a structured value (a record), so it carries a version so future
// shape changes can migrate or safely discard stale data; legacy bare
// `Record<string, boolean>` values are migrated forward on the next write. The
// neighbouring `om:progress:expanded` flag is a trivial
// scalar booleans and deliberately stay raw (see their write sites). See
// `@open-mercato/shared/lib/browser/versionedPreference`.

/* `min-h-0` on both: a column flex child will not shrink below its content
 * height without it, and the wrapper (which is not itself a scroll box, so it
 * gets no automatic-minimum-size exemption) would otherwise push the sticky
 * footer past the fold once the nav is long enough to scroll. */
const SIDEBAR_SCROLL_FRAME = 'relative flex min-h-0 flex-1 flex-col'
/* `overflow-x-hidden` is load-bearing, not decoration: with only `overflow-y`
 * set, the x axis computes from `visible` to `auto`, so any row that overhung
 * the rail — a long unbreakable title, an injected widget — turned the nav into
 * a horizontally scrollable box. Pinning x to `hidden` leaves `truncate` as the
 * single overflow behaviour for a row. */
const SIDEBAR_SCROLL_AREA = 'flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto scrollbar-hide'
/* The scroll affordance is an overlay, so the list has to reserve its band —
 * otherwise the last row can never be scrolled clear of it and sits under the
 * chevron forever. Applied only while the affordance is on screen, and it
 * cannot oscillate: the padding is added when the list already scrolls, and
 * adding it keeps it scrolling. */
const SIDEBAR_AFFORDANCE_HEIGHT = 'h-10'
const SIDEBAR_SCROLL_AREA_RESERVED = 'pb-10'

/** One placeholder bar. Toned with the rail's own tokens rather than the DS
 *  `Skeleton`, whose `bg-surface-muted` is tuned for the page surface and
 *  disappears on the navy sidebar. */
const SIDEBAR_SKELETON_BAR =
  'animate-pulse rounded-md bg-sidebar-accent/60 motion-reduce:animate-none'

/**
 * The shape the rail loads into: two groups of rows under short overlines.
 *
 * Label widths are fixed rather than random so the rail does not reshuffle
 * between renders, and varied so the column reads as a list of names rather
 * than a stack of identical bars — which is what a single width looks like, and
 * what made the old placeholder read as noise.
 */
const SIDEBAR_SKELETON_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['w-24', 'w-32', 'w-20', 'w-28'],
  ['w-28', 'w-20', 'w-24'],
]

const SIDEBAR_OPEN_GROUPS_KEY = 'om:sidebarOpenGroups'
const SIDEBAR_OPEN_GROUPS_VERSION = 1

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'boolean')
  )
}

export type AppShellProps = {
  productName?: string
  logo?: ShellLogo
  email?: string
  canManageUpgradeActions?: boolean
  groups: {
    id?: string
    name: string
    defaultName?: string
    items: {
      id?: string
      href: string
      title: string
      defaultTitle?: string
      icon?: React.ReactNode
      iconName?: string
      iconMarkup?: string
      enabled?: boolean
      hidden?: boolean
      pageContext?: 'main' | 'admin' | 'settings' | 'profile'
      children?: {
        id?: string
        href: string
        title: string
        defaultTitle?: string
        icon?: React.ReactNode
        iconName?: string
        iconMarkup?: string
        enabled?: boolean
        hidden?: boolean
        pageContext?: 'main' | 'admin' | 'settings' | 'profile'
      }[]
    }[]
  }[]
  children: React.ReactNode
  rightHeaderSlot?: React.ReactNode
  /** Centred column of the topbar — the global search lives here. */
  centerHeaderSlot?: React.ReactNode
  currentTitle?: string
  breadcrumb?: Array<{ label: string; href?: string }>
  // Optional: full admin nav API to refresh sidebar client-side
  adminNavApi?: string
  version?: string
  settingsSectionTitle?: string
  settingsPathPrefixes?: string[]
  settingsSections?: SectionNavGroup[]
  profileSections?: SectionNavGroup[]
  profileSectionTitle?: string
  profilePathPrefixes?: string[]
  mobileSidebarSlot?: React.ReactNode
  /**
   * Hide the backend footer status bar (app version + terms/privacy links).
   * Intended for app developers and whitelabel/embedded deployments that want to
   * suppress the footer entirely. Defaults to `false` (footer shown); the app
   * layout passes `true` by default via `OM_HIDE_BACKEND_FOOTER`.
   */
  hideFooter?: boolean
  /**
   * How long (ms) to keep successfully completed progress operations visible
   * before auto-hiding. Pass `false` or `0` to disable. Defaults to 10 000 ms.
   */
  progressCompletedAutoHideMs?: number | false
}

type Breadcrumb = Array<{ label: string; href?: string }>

type SidebarGroup = AppShellProps['groups'][number]
type SidebarItem = SidebarGroup['items'][number]

function convertInjectedMenuItemToSidebarItem(item: InjectionMenuItem, title: string): SidebarItem | null {
  if (!item.href) return null
  return {
    id: item.id,
    href: item.href,
    title,
    defaultTitle: title,
    icon: resolveInjectedIcon(item.icon) ?? undefined,
    iconName: item.icon,
    enabled: true,
    hidden: false,
    pageContext: 'main',
  }
}

function resolveInjectedMenuLabel(
  item: { id: string; label?: string; labelKey?: string },
  t: (key: string, fallback?: string) => string,
): string {
  if (item.labelKey && item.label) return t(item.labelKey, item.label)
  if (item.labelKey) return t(item.labelKey, item.id)
  if (item.label && item.label.includes('.')) return t(item.label, item.id)
  return item.label ?? item.id
}


function mergeSidebarItemsWithInjected(
  items: SidebarItem[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SidebarItem[] {
  if (injectedItems.length === 0) return items

  const builtInById = new Map<string, SidebarItem>()
  for (const item of items) {
    builtInById.set(item.id ?? item.href, item)
  }

  const merged = mergeMenuItems(
    items.map((item) => ({
      id: item.id ?? item.href,
    })),
    injectedItems,
  )

  const result: SidebarItem[] = []
  for (const entry of merged) {
    if (entry.source === 'built-in') {
      const original = builtInById.get(entry.id)
      if (original) result.push(original)
      continue
    }
    const translatedLabel = resolveInjectedMenuLabel(
      { id: entry.id, label: entry.label, labelKey: entry.labelKey },
      t,
    )
    const converted = convertInjectedMenuItemToSidebarItem(
      {
        id: entry.id,
        label: translatedLabel,
        icon: entry.icon,
        href: entry.href,
      },
      translatedLabel,
    )
    if (converted) result.push(converted)
  }

  return result
}

function mergeSidebarGroupsWithInjected(
  groups: SidebarGroup[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SidebarGroup[] {
  if (injectedItems.length === 0) return groups

  const injectedByGroup = new Map<string, InjectionMenuItem[]>()
  const ungrouped: InjectionMenuItem[] = []

  for (const item of injectedItems) {
    if (item.groupId && item.groupId.trim().length > 0) {
      const groupItems = injectedByGroup.get(item.groupId) ?? []
      groupItems.push(item)
      injectedByGroup.set(item.groupId, groupItems)
      continue
    }
    ungrouped.push(item)
  }

  const nextGroups = groups.map((group, index) => {
    const groupId = group.id || resolveGroupKey(group)
    const groupInjected = [
      ...(injectedByGroup.get(groupId) ?? []),
      ...(index === 0 ? ungrouped : []),
    ]
    return {
      ...group,
      items: mergeSidebarItemsWithInjected(group.items, groupInjected, t),
    }
  })

  const existingIds = new Set(nextGroups.map((group) => group.id || resolveGroupKey(group)))
  for (const [groupId, items] of injectedByGroup.entries()) {
    if (existingIds.has(groupId)) continue
    const first = items[0]
    const label = first.groupLabelKey
      ? t(first.groupLabelKey, first.groupLabel ?? groupId)
      : (first.groupLabel ?? groupId)
    const groupItems = mergeSidebarItemsWithInjected([], items, t)
    if (groupItems.length === 0) continue
    nextGroups.push({
      id: groupId,
      name: label,
      defaultName: label,
      items: groupItems,
    })
  }

  return nextGroups
}

function mergeSectionGroupsWithInjected(
  sections: SectionNavGroup[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SectionNavGroup[] {
  if (injectedItems.length === 0) return sections
  const byGroup = new Map<string, InjectionMenuItem[]>()
  for (const item of injectedItems) {
    const groupId = item.groupId && item.groupId.trim().length > 0 ? item.groupId : 'injected'
    const bucket = byGroup.get(groupId) ?? []
    bucket.push(item)
    byGroup.set(groupId, bucket)
  }

  const nextSections = sections.map((section) => {
    const sectionItems = byGroup.get(section.id) ?? []
    if (sectionItems.length === 0) return section
    const mergedItems = mergeMenuItems(
      section.items.map((item) => ({ id: item.id, item })),
      sectionItems,
    ).flatMap((item) => {
      if (item.source === 'built-in') {
        const original = section.items.find((entry) => entry.id === item.id)
        return original ? [original] : []
      }
      if (!item.href) return []
      const label = resolveInjectedMenuLabel(item, t)
      return [{
        id: item.id,
        label,
        href: item.href,
        icon: resolveInjectedIcon(item.icon) ?? undefined,
      }]
    })
    return {
      ...section,
      items: mergedItems,
    }
  })

  for (const [sectionId, sectionItems] of byGroup.entries()) {
    const exists = nextSections.some((section) => section.id === sectionId)
    if (exists) continue
    const first = sectionItems[0]
    const label = first.groupLabelKey
      ? t(first.groupLabelKey, first.groupLabel ?? sectionId)
      : (first.groupLabel ?? sectionId)
    const items = sectionItems.flatMap((item) => {
      if (!item.href) return []
      const itemLabel = resolveInjectedMenuLabel(item, t)
      return [{
        id: item.id,
        label: itemLabel,
        href: item.href,
        icon: resolveInjectedIcon(item.icon) ?? undefined,
      }]
    })
    if (items.length === 0) continue
    nextSections.push({ id: sectionId, label, items })
  }

  return nextSections
}

function resolveGroupKey(group: SidebarGroup): string {
  if (group.id && group.id.length) return group.id
  if (group.defaultName && group.defaultName.length) return slugifySidebarId(group.defaultName)
  return slugifySidebarId(group.name)
}

function resolveItemKey(item: { id?: string; href: string }): string {
  const candidate = item.id?.trim()
  if (candidate && candidate.length > 0) return candidate
  return item.href
}

function SerializedIcon({ markup }: { markup: string }) {
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
}

function renderIcon(
  icon: React.ReactNode | undefined,
  iconName: string | undefined,
  iconMarkup: string | undefined,
  fallback: React.ReactNode,
) {
  if (icon) return icon
  if (iconName) {
    const resolved = resolveInjectedIcon(iconName)
    if (resolved) return resolved
  }
  if (iconMarkup) return <SerializedIcon markup={iconMarkup} />
  return fallback
}

const HeaderContext = createContext<{
  setBreadcrumb: (b?: Breadcrumb) => void
  setTitle: (t?: string) => void
} | null>(null)

export function ApplyBreadcrumb({ breadcrumb, title, titleKey }: { breadcrumb?: Array<{ label: string; href?: string; labelKey?: string }>; title?: string; titleKey?: string }) {
  const ctx = useContext(HeaderContext)
  const t = useT()
  const resolvedBreadcrumb = React.useMemo<Breadcrumb | undefined>(() => {
    if (!breadcrumb) return undefined
    return breadcrumb.map(({ label, labelKey, href }) => {
      const translated = labelKey ? t(labelKey) : undefined
      const finalLabel = translated && translated !== labelKey ? translated : label
      return {
        href,
        label: finalLabel,
      }
    })
  }, [breadcrumb, t])
  const resolvedTitle = React.useMemo(() => {
    if (!titleKey) return title
    const translated = t(titleKey)
    if (translated && translated !== titleKey) return translated
    return title
  }, [titleKey, title, t])
  React.useEffect(() => {
    ctx?.setBreadcrumb(resolvedBreadcrumb)
    if (resolvedTitle !== undefined) ctx?.setTitle(resolvedTitle)
  }, [ctx, resolvedBreadcrumb, resolvedTitle])
  return null
}

// DataTable icon used for dynamic custom entity records links
const DataTableIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="16" rx="2" ry="2"/>
    <line x1="3" y1="8" x2="21" y2="8"/>
    <line x1="9" y1="8" x2="9" y2="20"/>
    <line x1="15" y1="8" x2="15" y2="20"/>
  </svg>
)

const CustomizeIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.82l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.65 1.65 0 0 0 9 15a1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4 8a1.65 1.65 0 0 0-.6-1.82l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1.82l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.65 1.65 0 0 0 15 9a1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.65 1.65 0 0 0 19.4 15z" />
  </svg>
)

const BackArrowIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
)

/** One duration for the whole reveal, so height, fade and chevron land together. */
const SIDEBAR_COLLAPSE_MS = 200

/**
 * Height animation for a nav group, without measuring anything.
 *
 * The outer grid animates its single row between `0fr` and `1fr` and the inner
 * child clips — the one CSS trick that transitions to content height, which
 * `height: auto` cannot do. The rows stay mounted while collapsed, so `inert`
 * takes them out of the tab order and the accessibility tree; without it a
 * closed group would still be reachable by keyboard.
 *
 * Two details separate a smooth reveal from a rubber-band one, both borrowed
 * from the same pattern in PCA ERP's inspector:
 *
 *  - the rows fade with the height instead of appearing at full opacity in a
 *    0px-tall box, so the group grows *into* view rather than being unmasked;
 *  - the clip is RELEASED once the group is fully open. `overflow-hidden` is
 *    only needed while the box is shorter than its content; leaving it on
 *    afterwards would crop a focus ring or a row's hover pill against the
 *    group's edge.
 */
function SidebarCollapse({
  id,
  open,
  children,
}: {
  id?: string
  open: boolean
  children: React.ReactNode
}) {
  const [clip, setClip] = React.useState(!open)
  React.useEffect(() => {
    if (!open) {
      setClip(true)
      return
    }
    const timer = window.setTimeout(() => setClip(false), SIDEBAR_COLLAPSE_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  return (
    <div
      id={id}
      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
      inert={!open}
    >
      <div className={clip ? 'overflow-hidden' : 'overflow-visible'}>
        {/* `pt-1` lives INSIDE the clip so the gap under the heading collapses
            with the rows; as a margin on the wrapper it would leave a 4px ghost
            behind every closed group. */}
        <div
          className={`flex flex-col gap-1 pt-1 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** Points down when the group is open and swings to the right when it closes —
 *  a quarter turn reads as "this folds away", where a half turn (down → up)
 *  reads as "this scrolls the other way". */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
  )
}

export function AppShell(props: AppShellProps) {
  return (
    <QueryProvider>
      <BackendChromeProvider adminNavApi={props.adminNavApi}>
        <AiChatSessionsProvider>
          <AiDockProvider>
            <AppShellBody {...props} />
          </AiDockProvider>
        </AiChatSessionsProvider>
      </BackendChromeProvider>
    </QueryProvider>
  )
}

function AppShellBody({ productName, logo, email, canManageUpgradeActions = false, groups, rightHeaderSlot, centerHeaderSlot, children, currentTitle, breadcrumb, version, settingsSectionTitle, settingsPathPrefixes = [], settingsSections, profileSections, profileSectionTitle, profilePathPrefixes = [], mobileSidebarSlot, hideFooter = false, progressCompletedAutoHideMs }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useT()
  const locale = useLocale()
  const { payload: chromePayload, isReady: isChromeReady, isLoading: isChromeLoading } = useBackendChrome()
  const resolvedGroups = React.useMemo(
    () => cloneSidebarGroups(chromePayload?.groups ?? groups),
    [chromePayload?.groups, groups],
  )
  const resolvedSettingsSections = chromePayload?.settingsSections ?? settingsSections
  const resolvedSettingsPathPrefixes = chromePayload?.settingsPathPrefixes ?? settingsPathPrefixes
  const resolvedProfileSections = chromePayload?.profileSections ?? profileSections
  const resolvedProfilePathPrefixes = chromePayload?.profilePathPrefixes ?? profilePathPrefixes
  const { items: mainSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:main')
  const { items: settingsSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:settings')
  const { items: profileSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:profile')
  const { items: topbarInjectedMenuItems } = useInjectedMenuItems('menu:topbar:actions')
  useEventBridge() // SSE DOM Event Bridge — singleton SSE connection for real-time server events
  const resolvedProductName = productName ?? t('appShell.productName')
  const resolvedLogo = chromePayload?.brand?.logo?.src ? chromePayload.brand.logo : logo
  const resolvedBrandName = chromePayload?.brand?.logo?.src
    ? chromePayload.brand.name ?? resolvedProductName
    : resolvedProductName
  const resolvedLogoBypassesOptimization = shouldBypassLogoOptimization(resolvedLogo?.src)
  const brandNameIsInLogo = usesBuiltInWordmark(resolvedLogo, resolvedBrandName)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // When the mobile drawer opens on a settings/profile route, it follows the
  // section sidebar by default. Set to 'main' to force-show the main nav even
  // when the route is in a section context. Reset on close.
  const [mobileDrawerView, setMobileDrawerView] = React.useState<'auto' | 'main'>('auto')
  // Clear the persistent record-conflict bar when the route changes. The
  // conflict is scoped to the record the user was editing, so navigating to an
  // unrelated page should dismiss it instead of carrying a stale "Record
  // changed" bar across modules.
  React.useEffect(() => {
    dismissRecordConflict()
  }, [pathname])
  React.useEffect(() => {
    if (!mobileOpen) setMobileDrawerView('auto')
  }, [mobileOpen])
  // Maintain internal nav state so we can augment it client-side
  const [navGroups, setNavGroups] = React.useState(resolvedGroups)
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(resolvedGroups.map((g) => [resolveGroupKey(g), true])) as Record<string, boolean>
  )
  const [headerTitle, setHeaderTitle] = React.useState<string | undefined>(currentTitle)
  const [headerBreadcrumb, setHeaderBreadcrumb] = React.useState<Breadcrumb | undefined>(breadcrumb)
  const [navQuery, setNavQuery] = React.useState('')
  const navQueryNorm = navQuery.trim().toLowerCase()
  const navQueryActive = navQueryNorm.length > 0
  const matchesQuery = React.useCallback((label: string | undefined) => {
    if (!navQueryActive) return true
    if (!label) return false
    return label.toLowerCase().includes(navQueryNorm)
  }, [navQueryActive, navQueryNorm])
  /* The rail is a fixed, always-open column. There is no collapse: a nav that
     can hide itself has to keep an icon-only mirror of every row, and the two
     drift. The only responsive step left is the `lg:` breakpoint, below which
     the whole column becomes the mobile drawer.

     304px, not the old 240px: at 240 the label box was only 160px wide, so real
     nav titles ("User Notification Preferences", "Create Workflow Definition")
     were ellipsed and the nav could not be read without hovering. 304 leaves
     212px even at child depth (24 gutter + 24 indent + 12 pad + 20 icon +
     12 gap), which clears the longest title any module ships. It is published
     as `--sidebar-width` so the grid column below cannot drift from the
     aside's own width — they were two literals before. */
  const SIDEBAR_WIDTH = '304px'

  // Track scroll position of the desktop sidebar's inner scroll container so we can
  // flip the affordance chevron between down/up (and hide it entirely when content
  // fits without scrolling). The inner div is rendered deep in renderSidebar /
  // renderSectionSidebar — we tag it with `data-sidebar-scroll="true"` and look it
  // up via the aside ref so we don't have to thread refs through the JSX tree.
  const sidebarAsideRef = React.useRef<HTMLElement>(null)
  const [sidebarScrollState, setSidebarScrollState] = React.useState<'down' | 'up' | 'none'>('down')
  const sidebarScrollIntentRef = React.useRef<'top' | 'bottom' | null>(null)

  // Click-to-scroll handler for the sidebar affordance chevron (#1803). Resolves the
  // scroll target lazily through the aside ref so we don't have to thread refs into
  // renderSidebar; respects `prefers-reduced-motion` by falling back to instant
  // scrolling when the user has opted out of smooth motion.
  const handleSidebarChevronScroll = React.useCallback((target: 'top' | 'bottom') => {
    const aside = sidebarAsideRef.current
    if (!aside) return
    const scrollTarget = aside.querySelector<HTMLElement>('[data-sidebar-scroll="true"]')
    if (!scrollTarget) return
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'
    const maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight)
    if (maxScrollTop <= 1) {
      sidebarScrollIntentRef.current = null
      setSidebarScrollState('none')
      return
    }
    sidebarScrollIntentRef.current = target
    setSidebarScrollState(target === 'bottom' ? 'up' : 'down')
    scrollTarget.scrollTo({
      top: target === 'top' ? 0 : maxScrollTop,
      behavior,
    })
  }, [])
  React.useEffect(() => {
    const aside = sidebarAsideRef.current
    if (!aside) return
    const target = aside.querySelector<HTMLElement>('[data-sidebar-scroll="true"]')
    if (!target) return
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = target
      const canScroll = scrollHeight > clientHeight + 1
      if (!canScroll) {
        sidebarScrollIntentRef.current = null
        setSidebarScrollState('none')
        return
      }
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
      const atTop = scrollTop <= 8
      const atBottom = scrollTop >= maxScrollTop - 8
      const scrollIntent = sidebarScrollIntentRef.current
      if (scrollIntent === 'bottom') {
        if (atBottom) sidebarScrollIntentRef.current = null
        setSidebarScrollState('up')
        return
      }
      if (scrollIntent === 'top') {
        if (atTop) sidebarScrollIntentRef.current = null
        setSidebarScrollState('down')
        return
      }
      setSidebarScrollState(atBottom ? 'up' : 'down')
    }
    update()
    target.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(target)
    return () => {
      target.removeEventListener('scroll', update)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  const injectionContext = React.useMemo(
    () => ({
      path: pathname ?? '',
      query: searchParams?.toString() ?? '',
    }),
    [pathname, searchParams],
  )

  // AppShell-owned transport for the current detail record (Phase 0 / S2).
  // Detail pages publish here; the merged context feeds the global
  // `backend:record:current` mount so the record_locks widget can resolve the
  // resource without a hardcoded path allowlist. Stale context (published for a
  // different path) is ignored so it never leaks across route transitions.
  const [currentRecordInjectionContext, setCurrentRecordInjectionContext] =
    React.useState<RecordInjectionContext | null>(null)

  const recordInjectionContext = React.useMemo(() => {
    if (!currentRecordInjectionContext) return injectionContext
    const publishedPath = currentRecordInjectionContext.path
    if (publishedPath && pathname && publishedPath !== pathname) return injectionContext
    return { ...injectionContext, ...currentRecordInjectionContext }
  }, [injectionContext, currentRecordInjectionContext, pathname])

  const isOnSettingsPath = React.useMemo(() => {
    if (!pathname) return false
    if (pathname === '/backend/settings') return true
    return resolvedSettingsPathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, resolvedSettingsPathPrefixes])

  const isOnProfilePath = React.useMemo(() => {
    if (!pathname) return false
    if (pathname === '/backend/profile') return true
    return resolvedProfilePathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, resolvedProfilePathPrefixes])

  const sidebarMode: 'main' | 'settings' | 'profile' =
    isOnSettingsPath ? 'settings' :
    isOnProfilePath ? 'profile' :
    'main'

  const mainNavGroupsWithInjected = React.useMemo(
    () => mergeSidebarGroupsWithInjected(navGroups, mainSidebarInjectedMenuItems, t),
    [mainSidebarInjectedMenuItems, navGroups, t],
  )

  // Lock body scroll when mobile drawer is open so touch scroll stays in the drawer
  React.useEffect(() => {
    if (!mobileOpen || typeof document === 'undefined') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  React.useEffect(() => {
    const parsed = readVersionedPreference<Record<string, boolean>>(
      SIDEBAR_OPEN_GROUPS_KEY,
      SIDEBAR_OPEN_GROUPS_VERSION,
      isBooleanRecord,
      {},
      { legacyIsValid: isBooleanRecord },
    )
    if (Object.keys(parsed).length === 0) return
    setOpenGroups((prev) => {
      const next = { ...prev }
      for (const group of resolvedGroups) {
        const key = resolveGroupKey(group)
        if (key in parsed) next[key] = !!parsed[key]
        else if (group.name in parsed) next[key] = !!parsed[group.name]
      }
      return next
    })
  }, [resolvedGroups])

  const toggleGroup = (groupId: string) => setOpenGroups((prev) => ({ ...prev, [groupId]: prev[groupId] === false }))

  // Use min-h-svh so the border extends with tall content; no overflow so sticky bottom works
  /* No top padding: the brand row is `h-16`, exactly the topbar's height, so the
     logo sits on the topbar's centre line and the search field below it starts
     level with the first pixel of page content. */
  const asideClassesBase = `border-r border-sidebar-border bg-sidebar text-sidebar-foreground ${SIDEBAR_GUTTER} pb-4`

  React.useEffect(() => {
    writeVersionedPreference(SIDEBAR_OPEN_GROUPS_KEY, SIDEBAR_OPEN_GROUPS_VERSION, openGroups)
  }, [openGroups])

  // Ensure current route's group is expanded on load
  React.useEffect(() => {
    const activeGroup = navGroups.find((g) => g.items.some((i) => pathname?.startsWith(i.href)))
    if (!activeGroup) return
    const key = resolveGroupKey(activeGroup)
    setOpenGroups((prev) => (prev[key] === false ? { ...prev, [key]: true } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, navGroups])
  // Keep header state in sync with props (server-side updates)
  React.useEffect(() => {
    setHeaderTitle(currentTitle)
    setHeaderBreadcrumb(breadcrumb)
  }, [currentTitle, breadcrumb])
  // Clear breadcrumb on client-side navigation so stale state doesn't persist;
  // the new page's ApplyBreadcrumb (if any) will set the correct values.
  // Must be a layout effect: when a prefetched navigation commits the new
  // pathname and the new page together, child passive effects (ApplyBreadcrumb)
  // run before parent ones, so a passive clear here would wipe the value the
  // incoming page just set.
  const prevPathname = React.useRef(pathname)
  useIsomorphicLayoutEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname
      setHeaderTitle(undefined)
      setHeaderBreadcrumb(undefined)
    }
  }, [pathname])

  // Keep navGroups in sync when server-provided groups change
  React.useEffect(() => {
    setNavGroups(cloneSidebarGroups(resolvedGroups))
  }, [resolvedGroups])

  /** The brand header. Shared by the main nav, the section navs and the loading
   *  skeleton so the three can never drift out of alignment.
   *
   *  No hover fill: the logo is an identity mark that happens to be clickable,
   *  not a nav row, and painting it on hover made the top of the rail flash a
   *  panel that nothing below it matched. The focus ring still marks it as a
   *  target for keyboard users. */
  function renderBrandHeader() {
    return (
      <Link
        href="/backend"
        className="flex h-16 shrink-0 items-center gap-3 rounded-lg px-3 outline-none focus-visible:shadow-focus"
        aria-label={t('appShell.goToDashboard')}
      >
        <ShellBrandLogo
          logo={resolvedLogo}
          brandName={resolvedBrandName}
          unoptimized={resolvedLogoBypassesOptimization}
        />
        {!brandNameIsInLogo && (
          <span className={SIDEBAR_BRAND_LABEL}>{resolvedBrandName}</span>
        )}
      </Link>
    )
  }

  /**
   * The scroll affordance — a fade plus a chevron that scrolls the nav to the
   * other end. It is anchored to the SCROLL FRAME rather than to the aside:
   * anchored to the aside it painted over the sticky footer's rule and its
   * widgets, because the aside's bottom edge is below where the list actually
   * ends. Desktop only — the state behind it is measured from the desktop
   * aside, so the mobile drawer has nothing to report.
   */
  function renderScrollAffordance() {
    if (sidebarScrollState === 'none') return null
    return (
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex ${SIDEBAR_AFFORDANCE_HEIGHT} items-end justify-center`}
      >
        {/* The fade is the "there is more below" signal, so it paints ONLY while
            there is. Held on at the bottom of the list it washed out the last
            row and claimed something was there that was not. */}
        {sidebarScrollState === 'down' ? (
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/80 to-transparent"
          />
        ) : null}
        {/* The IconButton owns hover/focus affordance; the inner span owns the
            rotate transition so it doesn't fight with the animate-bounce
            keyframes (both target `transform`). */}
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          data-testid="sidebar-scroll-chevron"
          data-sidebar-scroll-chevron={sidebarScrollState}
          aria-label={
            sidebarScrollState === 'up'
              ? t('ui.sidebar.chevron.scrollTop', 'Scroll to top')
              : t('ui.sidebar.chevron.scrollBottom', 'Scroll to bottom')
          }
          className="pointer-events-auto relative text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => handleSidebarChevronScroll(sidebarScrollState === 'up' ? 'top' : 'bottom')}
        >
          <span
            className={`inline-flex transition-transform duration-300 motion-reduce:transition-none ${sidebarScrollState === 'up' ? 'rotate-180' : ''}`}
          >
            <ChevronDown className="size-4 animate-bounce motion-reduce:animate-none" />
          </span>
        </IconButton>
      </div>
    )
  }

  /**
   * The section nav (Settings / Profile). It REPLACES the main nav in the one
   * rail rather than sitting beside it: the two-column arrangement only worked
   * because the main nav could shrink to an icon rail, and that rail is gone.
   * The back link below the brand mark is the labelled way out, since the mark
   * itself no longer advertises that it navigates.
   */
  /**
   * The section nav (Settings / Profile). It REPLACES the main nav in the one
   * rail rather than sitting beside it: the two-column arrangement only worked
   * because the main nav could shrink to an icon rail, and that rail is gone.
   * The back link below the brand mark is the labelled way out, since the mark
   * itself no longer advertises that it navigates.
   */
  function renderSectionSidebar(
    sections: SectionNavGroup[],
    title: string,
    hideHeader?: boolean,
  ) {
    const sortedSections = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const lastVisibleIndex = sortedSections.length - 1

    return (
      <div className="flex h-full flex-col gap-3" data-testid="appshell-section-sidebar">
        {!hideHeader && renderBrandHeader()}
        <Link
          href="/backend"
          className={`${SIDEBAR_ITEM_BASE} ${SIDEBAR_ITEM_BOX} shrink-0 ${sidebarItemStateClass(false)}`}
          data-testid="appshell-section-back-to-main"
          aria-label={t('backend.nav.backToMain', 'Back to Main')}
          onClick={() => setMobileOpen(false)}
        >
          <span className={SIDEBAR_ICON_BOX}>
            <ChevronLeft aria-hidden />
          </span>
          <span className={`${SIDEBAR_ITEM_LABEL} font-semibold`}>{title}</span>
        </Link>
        <SearchInput
          value={navQuery}
          onChange={setNavQuery}
          placeholder={t('appShell.searchNavPlaceholder', 'Search...')}
          aria-label={t('appShell.searchNavAria', 'Search navigation')}
          clearLabel={t('appShell.searchNavClear', 'Clear search')}
          size={SIDEBAR_SEARCH_SIZE}
          tone={SIDEBAR_SEARCH_TONE}
          className="shrink-0"
        />
        <div className={SIDEBAR_SCROLL_FRAME}>
        <div data-sidebar-scroll="true" className={`${SIDEBAR_SCROLL_AREA} ${!hideHeader && sidebarScrollState !== 'none' ? SIDEBAR_SCROLL_AREA_RESERVED : ''}`}>
          <nav className="flex flex-col gap-3" aria-label={title}>
          {sortedSections.map((section, sectionIndex) => {
            const matchesItemQuery = (item: typeof section.items[number]): boolean => {
              if (!navQueryActive) return true
              const label = item.labelKey ? t(item.labelKey, item.label) : item.label
              if (matchesQuery(label)) return true
              return Array.isArray(item.children) && item.children.some(matchesItemQuery)
            }
            const visibleItems = navQueryActive
              ? section.items.filter(matchesItemQuery)
              : section.items
            if (visibleItems.length === 0) return null
            const sortedItems = [...visibleItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            const sectionLabel = section.labelKey ? t(section.labelKey, section.label) : section.label
            const sectionKey = `settings:${section.id}`
            const regionId = `sidebar-section-${slugifySidebarId(section.id)}`
            const open = navQueryActive ? true : openGroups[sectionKey] !== false
            const sortSectionItems = (items: typeof section.items = []) =>
              [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            const filterChildren = (children: typeof section.items | undefined) => {
              if (!children) return [] as typeof section.items
              if (!navQueryActive) return [...children]
              return children.filter(matchesItemQuery)
            }

            const renderSectionItem = (item: (typeof section.items)[number], depth = 0): React.ReactNode => {
              const label = item.labelKey ? t(item.labelKey, item.label) : item.label
              const childItems = sortSectionItems(filterChildren(item.children))
              const isOnItemBranch = !!pathname && (
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`)
              )
              const hasActiveChild = !!(pathname && childItems.some((child) => (
                pathname === child.href ||
                pathname.startsWith(`${child.href}/`)
              )))
              const showChildren = childItems.length > 0 && (isOnItemBranch || navQueryActive)
              const isActive = isOnItemBranch || hasActiveChild

              return (
                <React.Fragment key={item.id}>
                  <Link
                    href={item.href}
                    className={`${SIDEBAR_ITEM_BASE} ${depth === 0 ? SIDEBAR_ITEM_BOX : SIDEBAR_CHILD_BOX} ${sidebarItemStateClass(isActive)}`}
                    style={depth > 1 ? { paddingLeft: `${24 + (depth - 1) * 12}px` } : undefined}
                    data-menu-item-id={item.id}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className={SIDEBAR_ICON_BOX}>
                      {renderIcon(
                        item.icon,
                        item.iconName,
                        item.iconMarkup,
                        item.href.includes('/backend/entities/user/') && item.href.endsWith('/records') ? DataTableIcon : DefaultIcon,
                      )}
                    </span>
                    <span className={SIDEBAR_ITEM_LABEL}>{label}</span>
                  </Link>
                  {showChildren ? childItems.map((child) => renderSectionItem(child, depth + 1)) : null}
                </React.Fragment>
              )
            }

            return (
              <div key={section.id}>
                <Button
                  type="button"
                  variant="muted"
                  onClick={() => toggleGroup(sectionKey)}
                  className={SIDEBAR_GROUP_LABEL}
                  aria-expanded={open}
                  aria-controls={regionId}
                >
                  <span className="min-w-0 truncate">{sectionLabel}</span>
                  <Chevron open={open} />
                </Button>
                <SidebarCollapse id={regionId} open={open}>
                  {sortedItems.map((item) => renderSectionItem(item))}
                </SidebarCollapse>
                {sectionIndex !== lastVisibleIndex && <div className={SIDEBAR_GROUP_DIVIDER} />}
              </div>
            )
          })}
        </nav>
        </div>
        {!hideHeader ? renderScrollAffordance() : null}
        </div>
      </div>
    )
  }

  function renderSidebar(hideHeader?: boolean, forceMainOnly?: boolean) {
    if (!isChromeReady && isChromeLoading) {
      // The placeholder is built from the rail's own boxes — the same row
      // height, the same heading box, the same group rhythm — so what loads in
      // lands exactly where the placeholder stood. The previous version drew
      // full-width blocks with no inner padding, which sat 12px left of every
      // real row icon and made the whole rail appear to shift on load.
      return (
        <div
          className="flex h-full flex-col gap-3"
          data-testid="backend-chrome-loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('appShell.loadingNavigation', 'Loading navigation')}
        >
          {!hideHeader ? renderBrandHeader() : null}
          {/* The search field is `lg`, the same 40px as a nav row. */}
          <div aria-hidden className={`h-10 shrink-0 rounded-lg ${SIDEBAR_SKELETON_BAR}`} />
          <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-3">
            {SIDEBAR_SKELETON_GROUPS.map((rows, groupIndex) => (
              <div key={groupIndex}>
                {/* A short overline on the real heading box, not a full-width
                    slab: a group label is a few characters, and drawing it the
                    width of the rail is what made headings and rows read as the
                    same thing. */}
                <div className={`flex items-center ${SIDEBAR_GROUP_LABEL_BOX}`}>
                  <span className={`h-2.5 w-16 ${SIDEBAR_SKELETON_BAR}`} />
                </div>
                <div className="flex flex-col gap-1 pt-1">
                  {rows.map((width, rowIndex) => (
                    <div key={rowIndex} className={`flex items-center ${SIDEBAR_ITEM_BOX}`}>
                      <span className={`${SIDEBAR_ICON_BOX} ${SIDEBAR_SKELETON_BAR}`} />
                      <span className={`h-3 ${width} ${SIDEBAR_SKELETON_BAR}`} />
                    </div>
                  ))}
                </div>
                {groupIndex !== SIDEBAR_SKELETON_GROUPS.length - 1 ? (
                  <div className={SIDEBAR_GROUP_DIVIDER} />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (!forceMainOnly && sidebarMode === 'settings' && resolvedSettingsSections && resolvedSettingsSections.length > 0) {
      const mergedSettingsSections = mergeSectionGroupsWithInjected(
        resolvedSettingsSections,
        settingsSidebarInjectedMenuItems,
        t,
      )
      return renderSectionSidebar(
        mergedSettingsSections,
        settingsSectionTitle ?? t('backend.nav.settings', 'Settings'),
        hideHeader,
      )
    }

    if (!forceMainOnly && sidebarMode === 'profile' && resolvedProfileSections && resolvedProfileSections.length > 0) {
      const mergedProfileSections = mergeSectionGroupsWithInjected(
        resolvedProfileSections,
        profileSidebarInjectedMenuItems,
        t,
      )
      return renderSectionSidebar(
        mergedProfileSections,
        profileSectionTitle ?? t('backend.nav.profile', 'Profile'),
        hideHeader,
      )
    }

    const isMobileVariant = !!hideHeader
    const shouldRenderSidebarInjectionSpots = !isMobileVariant

    return (
      <div className="flex h-full flex-col gap-3">
        {!hideHeader && renderBrandHeader()}
        {shouldRenderSidebarInjectionSpots ? (
          <InjectionSpot
            spotId={BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID}
            context={injectionContext}
          />
        ) : null}
        <SearchInput
          value={navQuery}
          onChange={setNavQuery}
          placeholder={t('appShell.searchNavPlaceholder', 'Search...')}
          aria-label={t('appShell.searchNavAria', 'Search navigation')}
          clearLabel={t('appShell.searchNavClear', 'Clear search')}
          size={SIDEBAR_SEARCH_SIZE}
          tone={SIDEBAR_SEARCH_TONE}
          className="shrink-0"
        />
        <div className={SIDEBAR_SCROLL_FRAME}>
        <div data-sidebar-scroll="true" className={`${SIDEBAR_SCROLL_AREA} ${shouldRenderSidebarInjectionSpots && sidebarScrollState !== 'none' ? SIDEBAR_SCROLL_AREA_RESERVED : ''}`}>
          {(() => {
              const isSettingsPath = (href: string) => {
                if (href === '/backend/settings') return true
                return resolvedSettingsPathPrefixes.some((prefix) => href.startsWith(prefix))
              }

              const isMainItem = (item: SidebarItem) => {
                if (item.pageContext && item.pageContext !== 'main') return false
                if (isSettingsPath(item.href)) return false
                return true
              }

              const mainGroups = mainNavGroupsWithInjected.map((g) => ({
                ...g,
                items: g.items.filter((item) => isMainItem(item) && item.hidden !== true),
              })).filter((g) => g.items.length > 0)

              const mainLastVisibleGroupIndex = (() => {
                for (let idx = mainGroups.length - 1; idx >= 0; idx -= 1) {
                  if (mainGroups[idx].items.some((item) => item.hidden !== true)) return idx
                }
                return -1
              })()

              return (
                <nav className="flex flex-col gap-3" data-testid="sidebar" aria-label={t('appShell.mainNavAria', 'Main navigation')}>
                  {shouldRenderSidebarInjectionSpots ? (
                    <InjectionSpot
                      spotId={BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID}
                      context={injectionContext}
                    />
                  ) : null}
                  {mainGroups.map((g, gi) => {
                    const groupId = resolveGroupKey(g)
                    const regionId = `sidebar-group-${slugifySidebarId(groupId)}`
                    const open = navQueryActive ? true : openGroups[groupId] !== false
                    const visibleItems = g.items.filter((item) => {
                      if (item.hidden === true) return false
                      if (!navQueryActive) return true
                      if (matchesQuery(item.title)) return true
                      const itemChildren = (item.children ?? []).filter((c) => c.hidden !== true)
                      return itemChildren.some((c) => matchesQuery(c.title))
                    })
                    if (visibleItems.length === 0) return null
                    return (
                      <div key={groupId}>
                        <Button
                          type="button"
                          variant="muted"
                          onClick={() => toggleGroup(groupId)}
                          className={SIDEBAR_GROUP_LABEL}
                          aria-expanded={open}
                          aria-controls={regionId}
                        >
                          <span className="min-w-0 truncate">{g.name}</span>
                          <Chevron open={open} />
                        </Button>
                        <SidebarCollapse id={regionId} open={open}>
                          {visibleItems.map((i) => {
                              const allChildItems = (i.children ?? []).filter((child) => child.hidden !== true)
                              /* Subpages are ALWAYS listed. They used to unfold only once the
                                 route was already inside the parent's branch, which meant the
                                 sidebar could not be used to find them — you had to know Deals
                                 had a Pipeline and a Map before it would tell you. Search still
                                 narrows the list; nothing else hides it. */
                              const childItems = navQueryActive
                                ? allChildItems.filter((c) => matchesQuery(c.title))
                                : allChildItems
                              const showChildren = childItems.length > 0
                              const hasActiveChild = !!(pathname && allChildItems.some((c) => pathname.startsWith(c.href)))
                              /* "On the branch" has to be asked directly now that it can no
                                 longer be inferred from the children being visible — otherwise
                                 every parent with subpages would read as active. */
                              const isOnParentBranch = !!pathname && pathname.startsWith(i.href)
                              const isParentActive = pathname === i.href || (isOnParentBranch && !hasActiveChild)
                              return (
                                <React.Fragment key={i.href}>
                                  <Link
                                    href={i.href}
                                    className={`${SIDEBAR_ITEM_BASE} ${SIDEBAR_ITEM_BOX} ${sidebarItemStateClass(isParentActive)} ${i.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                                    aria-disabled={i.enabled === false || undefined}
                                    data-menu-item-id={i.id ?? i.href}
                                    onClick={() => setMobileOpen(false)}
                                  >
                                    <span className={SIDEBAR_ICON_BOX}>
                                      {renderIcon(
                                        i.icon,
                                        i.iconName,
                                        i.iconMarkup,
                                        DefaultIcon,
                                      )}
                                    </span>
                                    <span className={SIDEBAR_ITEM_LABEL}>{i.title}</span>
                                  </Link>
                                  {showChildren ? (
                                    /* No guide rail down the left: the child box's own indent
                                       already reads as depth, and a hairline behind rows that
                                       are always present adds a second, permanent vertical
                                       line to a column that already has one at its edge. */
                                    <div className="flex flex-col gap-1">
                                      {childItems.map((c) => {
                                        const childActive = pathname?.startsWith(c.href)
                                        return (
                                          <Link
                                            key={c.href}
                                            href={c.href}
                                            className={`${SIDEBAR_ITEM_BASE} ${SIDEBAR_CHILD_BOX} ${sidebarItemStateClass(!!childActive)} ${c.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                                            aria-disabled={c.enabled === false || undefined}
                                            data-menu-item-id={c.id ?? c.href}
                                            onClick={() => setMobileOpen(false)}
                                          >
                                            <span className={SIDEBAR_ICON_BOX}>
                                              {renderIcon(
                                                c.icon,
                                                c.iconName,
                                                c.iconMarkup,
                                                c.href.includes('/backend/entities/user/') && c.href.endsWith('/records') ? DataTableIcon : DefaultIcon,
                                              )}
                                            </span>
                                            <span className={SIDEBAR_ITEM_LABEL}>{c.title}</span>
                                          </Link>
                                        )
                                      })}
                                    </div>
                                  ) : null}
                                </React.Fragment>
                              )
                          })}
                        </SidebarCollapse>
                        {gi !== mainLastVisibleGroupIndex && <div className={SIDEBAR_GROUP_DIVIDER} />}
                      </div>
                    )
                  })}
                </nav>
              )
            })()}
        </div>
        {shouldRenderSidebarInjectionSpots ? renderScrollAffordance() : null}
        </div>
        {/* `empty:hidden` — all three spots return null when no module fills
            them, and a stock install would otherwise carry a stray rule and a
            band of dead space at the foot of the rail. */}
        <div className="sticky bottom-0 -mx-3 shrink-0 border-t border-sidebar-border bg-sidebar px-3 pt-3 empty:hidden">
          {shouldRenderSidebarInjectionSpots ? (
            <InjectionSpot
              spotId={BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID}
              context={injectionContext}
            />
          ) : null}
          {shouldRenderSidebarInjectionSpots ? (
            <StatusBadgeInjectionSpot
              spotId={GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID}
              context={injectionContext}
            />
          ) : null}
          {shouldRenderSidebarInjectionSpots ? (
            <InjectionSpot
              spotId={BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID}
              context={injectionContext}
            />
          ) : null}
        </div>
      </div>
    )
  }

  const isSectionView =
    (sidebarMode === 'settings' && !!resolvedSettingsSections && resolvedSettingsSections.length > 0) ||
    (sidebarMode === 'profile' && !!resolvedProfileSections && resolvedProfileSections.length > 0)
  const headerCtxValue = React.useMemo(() => ({
    setBreadcrumb: setHeaderBreadcrumb,
    setTitle: setHeaderTitle,
  }), [])
  const renderedTopbarInjectedActions = React.useMemo(
    () =>
      topbarInjectedMenuItems.map((item) => {
        const label = resolveInjectedMenuLabel(item, t)
        if (item.href) {
          return (
            <Link
              key={item.id}
              href={item.href}
              className="inline-flex items-center rounded border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
              data-menu-item-id={item.id}
            >
              {label}
            </Link>
          )
        }
        return (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            size="sm"
            data-menu-item-id={item.id}
            onClick={() => item.onClick?.()}
          >
            {label}
          </Button>
        )
      }),
    [t, topbarInjectedMenuItems],
  )

  return (
    <HeaderContext.Provider value={headerCtxValue}>
    {/* `--topbar-height` is what Sheet anchors drawers to. The topbar is `h-16`
        plus its 1px rule; the previous 61px slid every drawer up under it. */}
    <div
      className="relative min-h-svh lg:grid lg:grid-cols-[var(--sidebar-width)_1fr]"
      style={{ '--topbar-height': '65px', '--sidebar-width': SIDEBAR_WIDTH } as React.CSSProperties}
    >
      {/* Desktop sidebar — one fixed rail, `SIDEBAR_WIDTH` wide. Settings and
          Profile swap their own nav into it (see `renderSidebar`) rather than
          opening a second column beside it. */}
      {/* Scroll affordance (#1803) lives inside `renderSidebar`, anchored to the
          nav's own scroll frame — from out here it painted over the sticky
          footer, whose top edge is not the aside's bottom edge. */}
      <aside ref={sidebarAsideRef} className={`${asideClassesBase} hidden lg:block lg:sticky lg:top-0 lg:h-svh lg:self-start lg:overflow-hidden lg:relative`} style={{ width: SIDEBAR_WIDTH }}>
        {renderSidebar()}
      </aside>

      <div className="flex min-h-svh flex-col min-w-0">
        <header className="sticky top-0 z-sticky h-16 shrink-0 border-b border-border bg-surface-muted px-3 sm:px-4 lg:px-6 flex items-center gap-2 sm:gap-3">
          <div
            data-testid="backend-chrome-ready"
            data-ready={isChromeReady ? 'true' : 'false'}
            className="hidden"
          />
          <div className="flex flex-1 items-center gap-2 min-w-0">
            {/* Mobile menu button */}
            <IconButton variant="ghost" size="sm" className="lg:hidden" aria-label={t('appShell.openMenu')} onClick={() => setMobileOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </IconButton>
            {/* Header breadcrumb: always starts with Dashboard */}
            {(() => {
              const dashboardLabel = t('dashboard.title')
              const root: Breadcrumb = [{ label: dashboardLabel, href: '/backend' }]
              let rest: Breadcrumb = []
              if (headerBreadcrumb && headerBreadcrumb.length) {
                const first = headerBreadcrumb[0]
                const dup = first && (first.href === '/backend' || first.label === dashboardLabel || first.label?.toLowerCase() === 'dashboard')
                rest = dup ? headerBreadcrumb.slice(1) : headerBreadcrumb
              } else if (headerTitle) {
                rest = [{ label: headerTitle }]
              }
              const items = [...root, ...rest]
              if (items.length === 0) return null
              const home = items[0]
              const current = items.length > 1 ? items[items.length - 1] : null
              const mid = items.slice(1, -1)
              const hasMid = mid.length > 0
              return (
                <BreadcrumbNav divider="arrow" className="ml-2 lg:ml-3 text-sm">
                  <BreadcrumbList className="[&_[data-slot=breadcrumb-separator]_svg]:size-4">
                    <BreadcrumbItem>
                      {home.href && current ? (
                        <BreadcrumbLink asChild aria-label={home.label}>
                          <Link href={home.href}>
                            <Home className="size-4" aria-hidden="true" />
                          </Link>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage aria-label={home.label}>
                          <Home className="size-4" aria-hidden="true" />
                        </BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                    {current ? (
                      <>
                        {hasMid ? (
                          <>
                            <BreadcrumbSeparator className="md:hidden" />
                            <BreadcrumbItem className="md:hidden">
                              <BreadcrumbEllipsis aria-label={t('appShell.breadcrumb.collapsed', { count: mid.length })} />
                            </BreadcrumbItem>
                            {mid.map((b, i) => (
                              <React.Fragment key={`mid-${i}`}>
                                <BreadcrumbSeparator className="hidden md:inline-flex" />
                                <BreadcrumbItem className="hidden md:inline-flex">
                                  {b.href ? (
                                    <BreadcrumbLink asChild title={b.label}>
                                      <Link href={b.href}>{b.label}</Link>
                                    </BreadcrumbLink>
                                  ) : (
                                    <BreadcrumbLink title={b.label} aria-disabled="true" tabIndex={-1}>
                                      {b.label}
                                    </BreadcrumbLink>
                                  )}
                                </BreadcrumbItem>
                              </React.Fragment>
                            ))}
                          </>
                        ) : null}
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          <BreadcrumbPage title={current.label}>{current.label}</BreadcrumbPage>
                        </BreadcrumbItem>
                      </>
                    ) : null}
                  </BreadcrumbList>
                </BreadcrumbNav>
              )
            })()}
          </div>
          {centerHeaderSlot ? (
            <div className="flex shrink-0 items-center justify-center">{centerHeaderSlot}</div>
          ) : null}
          {/* `min-w-fit` keeps the action cluster from shrinking under its own
              icons: it may take more than its half and push the centre column
              off-centre, but it never overlaps it. */}
          <div className="flex flex-1 min-w-fit items-center justify-end gap-1.5 sm:gap-2 md:gap-3 text-sm">
            <StatusBadgeInjectionSpot
              spotId={GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID}
              context={injectionContext}
            />
            <InjectionSpot
              spotId={BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID}
              context={injectionContext}
            />
            {renderedTopbarInjectedActions}
            <AiAssistantLauncher variant="topbar" />
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <span className="opacity-80">{email || t('appShell.userFallback')}</span>
            )}
          </div>
        </header>
        <ProgressTopBar t={t} className="sticky top-0 z-sticky" completedAutoHideMs={progressCompletedAutoHideMs} />
        <main className="flex-1 px-4 pb-8 pt-4 sm:px-6 lg:px-8 lg:pt-5 mx-auto w-full max-w-screen-2xl">
          <InjectionSpot spotId={BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID} context={injectionContext} />
          <FlashMessages />
          <PartialIndexBanner />
          {canManageUpgradeActions ? <UpgradeActionBanner /> : null}
          <LastOperationBanner />
          <RecordConflictBanner />
          <InjectionSpot spotId={BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID} context={recordInjectionContext} />
          <InjectionSpot
            spotId={LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID}
            context={injectionContext}
          />
          <div id="om-top-banners" className="mb-3 space-y-2 empty:hidden" />
          <OrganizationScopeBoundary active={isOnSettingsPath}>
            <BackendRecordInjectionContextProvider setCurrentRecordInjectionContext={setCurrentRecordInjectionContext}>
              {children}
            </BackendRecordInjectionContextProvider>
          </OrganizationScopeBoundary>
          <InjectionSpot spotId={BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID} context={injectionContext} />
        </main>
        {hideFooter ? null : (
          <footer className="border-t border-border bg-surface px-4 py-3 sm:px-6 lg:px-8 flex flex-wrap items-center justify-end gap-4">
            {version ? (
              <span className="text-xs text-muted-foreground">
                {t('appShell.version', { version })}
              </span>
            ) : null}
            <nav className="flex items-center gap-3 text-xs text-muted-foreground">
              <Link href="/terms" className="transition hover:text-foreground">
                {t('common.terms')}
              </Link>
              <Link href="/privacy" className="transition hover:text-foreground">
                {t('common.privacy')}
              </Link>
            </nav>
          </footer>
        )}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-modal">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 flex h-full w-[var(--sidebar-width)] max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-lg overflow-hidden">
            <div className={`shrink-0 flex h-16 items-center justify-between gap-3 border-b border-sidebar-border ${DRAWER_CHROME_INSET}`}>
              <Link
                href="/backend"
                className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:shadow-focus"
                onClick={() => setMobileOpen(false)}
                aria-label={t('appShell.goToDashboard')}
              >
                <ShellBrandLogo logo={resolvedLogo} brandName={resolvedBrandName} mobile unoptimized={resolvedLogoBypassesOptimization} />
                {!brandNameIsInLogo && <span className={SIDEBAR_BRAND_LABEL}>{resolvedBrandName}</span>}
              </Link>
              <IconButton variant="ghost" size="sm" className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={() => setMobileOpen(false)} aria-label={t('appShell.closeMenu')}>
                <X className="size-4" />
              </IconButton>
            </div>
            {mobileSidebarSlot && (
              <div className={`shrink-0 border-b border-sidebar-border ${DRAWER_SLOT_INSET} py-2`}>
                {mobileSidebarSlot}
              </div>
            )}
            {sidebarMode !== 'main' ? (
              <div className={`shrink-0 flex items-center gap-5 border-b border-sidebar-border ${DRAWER_CHROME_INSET} pt-3 pb-0`} role="tablist">
                {([
                  { id: 'main' as const, label: t('backend.nav.main', 'Main') },
                  {
                    id: 'section' as const,
                    label:
                      sidebarMode === 'settings'
                        ? settingsSectionTitle ?? t('backend.nav.settings', 'Settings')
                        : profileSectionTitle ?? t('backend.nav.profile', 'Profile'),
                  },
                ]).map((tab) => {
                  const isActive =
                    tab.id === 'main' ? mobileDrawerView === 'main' : mobileDrawerView === 'auto'
                  const tabId = `mobile-drawer-tab-${tab.id}`
                  return (
                    <button
                      key={tab.id}
                      id={tabId}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls="mobile-drawer-tabpanel"
                      onClick={() => setMobileDrawerView(tab.id === 'main' ? 'main' : 'auto')}
                      className="relative inline-flex items-center pb-2 text-sm font-medium leading-5 tracking-tight transition-colors outline-none focus-visible:shadow-focus data-[active=true]:text-sidebar-foreground data-[active=false]:text-sidebar-muted-foreground hover:text-sidebar-foreground"
                      data-active={isActive}
                    >
                      <span>{tab.label}</span>
                      {isActive ? (
                        <span
                          className="absolute -bottom-px left-0 right-0 h-0.5 bg-sidebar-primary"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <div
              id="mobile-drawer-tabpanel"
              role={sidebarMode !== 'main' ? 'tabpanel' : undefined}
              aria-labelledby={
                sidebarMode !== 'main'
                  ? `mobile-drawer-tab-${mobileDrawerView === 'main' ? 'main' : 'section'}`
                  : undefined
              }
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3"
            >
              {/* The drawer paints its own brand row above, so the nav renders headerless. */}
              {renderSidebar(true, mobileDrawerView === 'main')}
            </div>
          </aside>
        </div>
      )}
    </div>
    <UmesDevToolsPanel />
    </HeaderContext.Provider>
  )
}
