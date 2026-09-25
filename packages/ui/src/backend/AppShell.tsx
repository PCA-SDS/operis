"use client"
import * as React from 'react'
import { createContext, useContext } from 'react'
import Link from 'next/link'
import { Home } from 'lucide-react'
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
import { FlashMessages } from './FlashMessages'
import { QueryProvider } from '../theme/QueryProvider'
import { usePathname, useSearchParams } from 'next/navigation'
import { LastOperationBanner } from './operations/LastOperationBanner'
import { RecordConflictBanner } from './conflicts/RecordConflictBanner'
import { dismissRecordConflict } from './conflicts/store'
import { ProgressTopBar } from './progress/ProgressTopBar'
import { UpgradeActionBanner } from './upgrades/UpgradeActionBanner'
import { PartialIndexBanner } from './indexes/PartialIndexBanner'
import { OrganizationScopeBoundary } from './OrganizationScopeBoundary'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cloneSidebarGroups } from './sidebar/customization-helpers'
import {
  ShellBrandLogo,
  shouldBypassLogoOptimization,
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
import { LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID } from './injection/mutationEvents'
import { useInjectedMenuItems } from './injection/useInjectedMenuItems'
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
  BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID,
  GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID,
} from './injection/spotIds'
import {
  mergeNavGroupsWithInjected,
  mergeSectionGroupsWithInjected,
  resolveActiveGroup,
  resolveGroupKey,
  resolveInjectedMenuLabel,
  selectModuleGroups,
  type NavGroup,
} from './module-nav/model'
import {
  BackendNavigationProvider,
  type BackendNavigation,
  type BackendNavigationMode,
} from './module-nav/BackendNavigationContext'
import { ModuleSwitcher } from './module-nav/ModuleSwitcher'

export type AppShellProps = {
  productName?: string
  logo?: ShellLogo
  email?: string
  canManageUpgradeActions?: boolean
  groups: NavGroup[]
  children: React.ReactNode
  rightHeaderSlot?: React.ReactNode
  /** Centred column of the topbar — the global search lives here. */
  centerHeaderSlot?: React.ReactNode
  currentTitle?: string
  breadcrumb?: Array<{ label: string; href?: string }>
  // Optional: full admin nav API to refresh navigation client-side
  adminNavApi?: string
  version?: string
  settingsSectionTitle?: string
  settingsPathPrefixes?: string[]
  settingsSections?: SectionNavGroup[]
  profileSections?: SectionNavGroup[]
  profileSectionTitle?: string
  profilePathPrefixes?: string[]
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

const EMPTY_SECTIONS: SectionNavGroup[] = []

function isUnderAnyPrefix(path: string, prefixes: string[], root: string): boolean {
  if (path === root) return true
  return prefixes.some((prefix) => path.startsWith(prefix))
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

/**
 * The backend frame: topbar, banners, page, footer. There is no global
 * sidebar — the topbar's module switcher opens a module, and the module's own
 * sidebar sits beside its pages (`BackendModuleFrame`). The shell resolves the
 * navigation once and publishes it through `BackendNavigationProvider` so both
 * read the same model.
 */
function AppShellBody({ productName, logo, email, canManageUpgradeActions = false, groups, rightHeaderSlot, centerHeaderSlot, children, currentTitle, breadcrumb, version, settingsSectionTitle, settingsPathPrefixes = [], settingsSections, profileSections, profileSectionTitle, profilePathPrefixes = [], hideFooter = false, progressCompletedAutoHideMs }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useT()
  const { payload: chromePayload, isReady: isChromeReady, isLoading: isChromeLoading } = useBackendChrome()
  const resolvedGroups = React.useMemo(
    () => cloneSidebarGroups(chromePayload?.groups ?? groups),
    [chromePayload?.groups, groups],
  )
  const resolvedSettingsSections = chromePayload?.settingsSections ?? settingsSections ?? EMPTY_SECTIONS
  const resolvedSettingsPathPrefixes = chromePayload?.settingsPathPrefixes ?? settingsPathPrefixes
  const resolvedProfileSections = chromePayload?.profileSections ?? profileSections ?? EMPTY_SECTIONS
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
  // Clear the persistent record-conflict bar when the route changes. The
  // conflict is scoped to the record the user was editing, so navigating to an
  // unrelated page should dismiss it instead of carrying a stale "Record
  // changed" bar across modules.
  React.useEffect(() => {
    dismissRecordConflict()
  }, [pathname])
  const [headerTitle, setHeaderTitle] = React.useState<string | undefined>(currentTitle)
  const [headerBreadcrumb, setHeaderBreadcrumb] = React.useState<Breadcrumb | undefined>(breadcrumb)
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

  const isOnSettingsPath = !!pathname && isUnderAnyPrefix(pathname, resolvedSettingsPathPrefixes, '/backend/settings')
  const isOnProfilePath = !!pathname && isUnderAnyPrefix(pathname, resolvedProfilePathPrefixes, '/backend/profile')
  const navigationMode: BackendNavigationMode = isOnSettingsPath
    ? (resolvedSettingsSections.length > 0 ? 'settings' : 'main')
    : isOnProfilePath && resolvedProfileSections.length > 0
      ? 'profile'
      : 'main'

  const moduleGroups = React.useMemo(() => {
    const isSettingsHref = (href: string) => isUnderAnyPrefix(href, resolvedSettingsPathPrefixes, '/backend/settings')
    return selectModuleGroups(mergeNavGroupsWithInjected(resolvedGroups, mainSidebarInjectedMenuItems, t), isSettingsHref)
  }, [mainSidebarInjectedMenuItems, resolvedGroups, resolvedSettingsPathPrefixes, t])
  const mergedSettingsSections = React.useMemo(
    () => mergeSectionGroupsWithInjected(resolvedSettingsSections, settingsSidebarInjectedMenuItems, t),
    [resolvedSettingsSections, settingsSidebarInjectedMenuItems, t],
  )
  const mergedProfileSections = React.useMemo(
    () => mergeSectionGroupsWithInjected(resolvedProfileSections, profileSidebarInjectedMenuItems, t),
    [resolvedProfileSections, profileSidebarInjectedMenuItems, t],
  )
  const [routeGroupHint, setRouteGroupHint] = React.useState<string | null>(null)
  const activeGroup = React.useMemo(() => {
    if (navigationMode !== 'main') return null
    const byPath = resolveActiveGroup(moduleGroups, pathname)
    if (byPath || !routeGroupHint) return byPath
    return moduleGroups.find((group) => resolveGroupKey(group) === routeGroupHint) ?? null
  }, [moduleGroups, navigationMode, pathname, routeGroupHint])
  const resolvedSettingsTitle = settingsSectionTitle ?? t('backend.nav.settings', 'Settings')
  const resolvedProfileTitle = profileSectionTitle ?? t('backend.nav.profile', 'Profile')
  const isNavigationReady = isChromeReady || !isChromeLoading
  const navigation = React.useMemo<BackendNavigation>(() => ({
    isReady: isNavigationReady,
    mode: navigationMode,
    moduleGroups,
    activeGroup,
    settings: { title: resolvedSettingsTitle, sections: mergedSettingsSections },
    profile: { title: resolvedProfileTitle, sections: mergedProfileSections },
    setRouteGroupHint,
  }), [activeGroup, isNavigationReady, mergedProfileSections, mergedSettingsSections, moduleGroups, navigationMode, resolvedProfileTitle, resolvedSettingsTitle])

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
    <BackendNavigationProvider value={navigation}>
    {/* `--topbar-height` is what Sheet anchors drawers to, and what module
        sidebars stick beneath. The topbar is `h-16` plus its 1px rule. */}
    <div
      className="relative min-h-svh"
      style={{ '--topbar-height': '65px' } as React.CSSProperties}
    >
      {/* `data-app-shell-column` is a styling hook only. `globals.css` uses it
          to pin the shell to the viewport for pages that opted into
          `<Page fill>`, and does nothing at all for every other page. */}
      <div data-app-shell-column="" className="flex min-h-svh min-w-0 flex-col">
        <header className="sticky top-0 z-sticky flex h-16 min-w-0 shrink-0 items-center gap-2 border-b border-border bg-surface-muted px-3 sm:gap-3 sm:px-4 lg:px-6">
          <div
            data-testid="backend-chrome-ready"
            data-ready={isChromeReady ? 'true' : 'false'}
            className="hidden"
          />
          {/* `min-w-9` keeps the module switcher on screen however hard the
              centre and action columns squeeze this one: it is the only way
              into a module, so it may never be crushed to nothing. */}
          <div className="flex min-w-9 flex-1 items-center gap-2">
            <Link
              href="/backend"
              className="hidden h-9 shrink-0 items-center gap-2 rounded-lg px-1 outline-none focus-visible:shadow-focus xl:flex"
              aria-label={t('appShell.goToDashboard')}
              data-testid="appshell-brand"
            >
              <ShellBrandLogo
                logo={resolvedLogo}
                brandName={resolvedBrandName}
                unoptimized={resolvedLogoBypassesOptimization}
                tone="surface"
              />
              {!brandNameIsInLogo && (
                <span className="truncate text-sm font-semibold text-foreground">{resolvedBrandName}</span>
              )}
            </Link>
            <ModuleSwitcher />
            {/* Header breadcrumb: always starts with Dashboard */}
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
                <BreadcrumbNav divider="arrow" className="ml-2 min-w-0 overflow-hidden text-sm lg:ml-3">
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
            <div className="flex min-w-0 shrink-0 items-center justify-center">{centerHeaderSlot}</div>
          ) : null}
          {/* `min-w-fit` keeps the action cluster from shrinking under its own
              icons: it may take more than its half and push the centre column
              off-centre, but it never overlaps it. */}
          <div className="flex min-w-fit max-sm:min-w-0 flex-1 items-center justify-end gap-1.5 text-sm sm:gap-2 md:gap-3">
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
        <main className="mx-auto flex min-w-0 w-full max-w-screen-2xl flex-1 flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8 lg:pt-5">
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
    </div>
    <UmesDevToolsPanel />
    </BackendNavigationProvider>
    </HeaderContext.Provider>
  )
}
