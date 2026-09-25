"use client"

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Circle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useIsomorphicLayoutEffect } from '../../hooks/useIsomorphicLayoutEffect'
import { InjectionSpot } from '../injection/InjectionSpot'
import { StatusBadgeInjectionSpot } from '../injection/StatusBadgeInjectionSpot'
import {
  BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID,
  GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID,
} from '../injection/spotIds'
import { useBackendNavigation, type BackendNavigation } from './BackendNavigationContext'
import {
  groupToNavSection,
  resolveActiveLinkKey,
  sectionsToNavSections,
  type ModuleNavLink,
  type ModuleNavSection,
} from './model'
import {
  MODULE_LAYOUT,
  ModuleSidebar,
  ModuleSidebarDivider,
  ModuleSidebarLink,
  ModuleSidebarSectionLabel,
  ModuleSidebarSkeleton,
} from './ModuleSidebar'

const FALLBACK_ICON = <Circle className="size-4" aria-hidden="true" />

type Translate = (key: string, fallback?: string) => string

type ResolvedModuleNav = { title: string; sections: ModuleNavSection[] }

function resolveModuleNav(nav: BackendNavigation, t: Translate): ResolvedModuleNav | null {
  if (nav.mode === 'settings' || nav.mode === 'profile') {
    const source = nav.mode === 'settings' ? nav.settings : nav.profile
    const sections = sectionsToNavSections(source.sections, t, FALLBACK_ICON)
    return sections.length > 0 ? { title: source.title, sections } : null
  }
  if (!nav.activeGroup) return null
  const section = groupToNavSection(nav.activeGroup, FALLBACK_ICON)
  return section.links.length > 0 ? { title: nav.activeGroup.name, sections: [section] } : null
}

function renderLink(link: ModuleNavLink, activeKey: string | null, depth: 0 | 1 = 0): React.ReactNode {
  return (
    <React.Fragment key={link.key}>
      <ModuleSidebarLink
        href={link.href}
        icon={link.icon}
        label={link.label}
        active={link.key === activeKey}
        disabled={link.disabled}
        depth={depth}
        data-menu-item-id={link.key}
      />
      {link.children.map((child) => renderLink(child, activeKey, 1))}
    </React.Fragment>
  )
}

/**
 * The sidebar of the module the current page belongs to — its pages for a
 * business module, the section list on Settings and Profile. Links only;
 * every destination still enforces its own guards on the server.
 */
function BackendModuleSidebar({ resolved, routeParentHref }: { resolved: ResolvedModuleNav; routeParentHref: string | null }) {
  const t = useT()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const injectionContext = React.useMemo(
    () => ({ path: pathname ?? '', query: searchParams?.toString() ?? '' }),
    [pathname, searchParams],
  )
  const activeKey = resolveActiveLinkKey(resolved.sections, pathname)
    ?? (routeParentHref ? resolveActiveLinkKey(resolved.sections, routeParentHref) : null)
  const label = t('appShell.moduleNav.label', '{module} navigation', { module: resolved.title })
  return (
    <ModuleSidebar label={label} title={resolved.title} data-testid="module-sidebar">
      <div className="hidden empty:hidden md:block">
        <InjectionSpot spotId={BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID} context={injectionContext} />
      </div>
      <div className="hidden empty:hidden md:block">
        <InjectionSpot spotId={BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID} context={injectionContext} />
      </div>
      {resolved.sections.map((section, index) => (
        <React.Fragment key={section.key}>
          {index > 0 ? <ModuleSidebarDivider /> : null}
          {section.label ? <ModuleSidebarSectionLabel>{section.label}</ModuleSidebarSectionLabel> : null}
          {section.links.map((link) => renderLink(link, activeKey))}
        </React.Fragment>
      ))}
      <div className="hidden empty:hidden md:block md:border-t md:border-border md:pt-2">
        <InjectionSpot spotId={BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID} context={injectionContext} />
        <StatusBadgeInjectionSpot spotId={GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID} context={injectionContext} />
        <InjectionSpot spotId={BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID} context={injectionContext} />
      </div>
    </ModuleSidebar>
  )
}

/**
 * Lays a backend page out beside its module's sidebar.
 *
 * `enabled` comes from the route's `moduleSidebar` metadata, read on the
 * server for every navigation, so a page that draws its own module navigation
 * (the Task Manager) never flashes a second one. `routeGroupId` and
 * `routeParentHref` are the route's declared nav group and breadcrumb parent:
 * they place a page that sits under no nav link (a hidden detail route) in its
 * module and light its parent page. While the navigation payload loads, a
 * placeholder holds the column so the page does not jump sideways when it
 * lands.
 *
 * The wrapper keeps one shape in every state — the sidebar slot sits before a
 * stable content column — so the page is never remounted when the sidebar
 * appears or goes.
 */
export function BackendModuleFrame({
  enabled,
  routeGroupId = null,
  routeParentHref = null,
  children,
}: {
  enabled: boolean
  routeGroupId?: string | null
  routeParentHref?: string | null
  children: React.ReactNode
}) {
  const t = useT()
  const nav = useBackendNavigation()
  const setRouteGroupHint = nav?.setRouteGroupHint
  useIsomorphicLayoutEffect(() => {
    if (!setRouteGroupHint) return
    setRouteGroupHint(routeGroupId)
    return () => setRouteGroupHint(null)
  }, [routeGroupId, setRouteGroupHint])
  const pending = enabled && !!nav && !nav.isReady
  const resolved = React.useMemo(
    () => (enabled && nav?.isReady ? resolveModuleNav(nav, t) : null),
    [enabled, nav, t],
  )
  let sidebar: React.ReactNode = null
  if (pending) sidebar = <ModuleSidebarSkeleton label={t('appShell.loadingNavigation', 'Loading navigation')} />
  else if (resolved) sidebar = <BackendModuleSidebar resolved={resolved} routeParentHref={routeParentHref} />
  return (
    <div className={cn(sidebar ? MODULE_LAYOUT : 'flex min-h-0 flex-1 flex-col')} data-module-frame="">
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
