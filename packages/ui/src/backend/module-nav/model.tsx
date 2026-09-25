import * as React from 'react'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { mergeMenuItems } from '../injection/mergeMenuItems'
import { resolveInjectedIcon } from '../injection/resolveInjectedIcon'
import type { SectionNavGroup, SectionNavItem } from '../section-page/types'

type Translate = (key: string, fallback?: string) => string

export type NavPageContext = 'main' | 'admin' | 'settings' | 'profile'

export type NavChildItem = {
  id?: string
  href: string
  title: string
  defaultTitle?: string
  icon?: React.ReactNode
  iconName?: string
  iconMarkup?: string
  enabled?: boolean
  hidden?: boolean
  pageContext?: NavPageContext
}

export type NavItem = NavChildItem & {
  children?: NavChildItem[]
}

export type NavGroup = {
  id?: string
  name: string
  defaultName?: string
  iconName?: string
  iconMarkup?: string
  items: NavItem[]
}

/**
 * One entry a module sidebar lists, whichever source it came from: a main nav
 * group's pages, or a settings / profile section's items. The sidebar renders
 * this shape only, so the two sources cannot drift apart visually.
 */
export type ModuleNavLink = {
  key: string
  href: string
  label: string
  icon: React.ReactNode
  disabled: boolean
  children: ModuleNavLink[]
}

export type ModuleNavSection = {
  key: string
  label: string | null
  links: ModuleNavLink[]
}

export function resolveGroupKey(group: NavGroup): string {
  if (group.id && group.id.length) return group.id
  if (group.defaultName && group.defaultName.length) return slugifySidebarId(group.defaultName)
  return slugifySidebarId(group.name)
}

function SerializedIcon({ markup }: { markup: string }) {
  return <span aria-hidden="true" className="inline-flex" dangerouslySetInnerHTML={{ __html: markup }} />
}

export function renderNavIcon(
  icon: React.ReactNode | undefined,
  iconName: string | undefined,
  iconMarkup: string | undefined,
  fallback: React.ReactNode,
): React.ReactNode {
  if (icon) return icon
  if (iconName) {
    const resolved = resolveInjectedIcon(iconName)
    if (resolved) return resolved
  }
  if (iconMarkup) return <SerializedIcon markup={iconMarkup} />
  return fallback
}

export function resolveInjectedMenuLabel(
  item: { id: string; label?: string; labelKey?: string },
  t: Translate,
): string {
  if (item.labelKey && item.label) return t(item.labelKey, item.label)
  if (item.labelKey) return t(item.labelKey, item.id)
  if (item.label && item.label.includes('.')) return t(item.label, item.id)
  return item.label ?? item.id
}

function convertInjectedMenuItemToNavItem(item: InjectionMenuItem, title: string): NavItem | null {
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

function mergeNavItemsWithInjected(items: NavItem[], injectedItems: InjectionMenuItem[], t: Translate): NavItem[] {
  if (injectedItems.length === 0) return items
  const builtInById = new Map<string, NavItem>()
  for (const item of items) builtInById.set(item.id ?? item.href, item)
  const merged = mergeMenuItems(items.map((item) => ({ id: item.id ?? item.href })), injectedItems)
  const result: NavItem[] = []
  for (const entry of merged) {
    if (entry.source === 'built-in') {
      const original = builtInById.get(entry.id)
      if (original) result.push(original)
      continue
    }
    const translatedLabel = resolveInjectedMenuLabel({ id: entry.id, label: entry.label, labelKey: entry.labelKey }, t)
    const converted = convertInjectedMenuItemToNavItem(
      { id: entry.id, label: translatedLabel, icon: entry.icon, href: entry.href },
      translatedLabel,
    )
    if (converted) result.push(converted)
  }
  return result
}

export function mergeNavGroupsWithInjected(
  groups: NavGroup[],
  injectedItems: InjectionMenuItem[],
  t: Translate,
): NavGroup[] {
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
    const groupId = resolveGroupKey(group)
    const groupInjected = [...(injectedByGroup.get(groupId) ?? []), ...(index === 0 ? ungrouped : [])]
    return { ...group, items: mergeNavItemsWithInjected(group.items, groupInjected, t) }
  })
  const existingIds = new Set(nextGroups.map((group) => resolveGroupKey(group)))
  for (const [groupId, items] of injectedByGroup.entries()) {
    if (existingIds.has(groupId)) continue
    const first = items[0]
    const label = first.groupLabelKey ? t(first.groupLabelKey, first.groupLabel ?? groupId) : (first.groupLabel ?? groupId)
    const groupItems = mergeNavItemsWithInjected([], items, t)
    if (groupItems.length === 0) continue
    nextGroups.push({ id: groupId, name: label, defaultName: label, items: groupItems })
  }
  return nextGroups
}

function injectedSectionItem(
  item: { id: string; label?: string; labelKey?: string; icon?: string; href?: string },
  t: Translate,
): SectionNavItem[] {
  if (!item.href) return []
  return [{
    id: item.id,
    label: resolveInjectedMenuLabel(item, t),
    href: item.href,
    icon: resolveInjectedIcon(item.icon) ?? undefined,
  }]
}

export function mergeSectionGroupsWithInjected(
  sections: SectionNavGroup[],
  injectedItems: InjectionMenuItem[],
  t: Translate,
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
      return injectedSectionItem(item, t)
    })
    return { ...section, items: mergedItems }
  })
  for (const [sectionId, sectionItems] of byGroup.entries()) {
    if (nextSections.some((section) => section.id === sectionId)) continue
    const first = sectionItems[0]
    const label = first.groupLabelKey ? t(first.groupLabelKey, first.groupLabel ?? sectionId) : (first.groupLabel ?? sectionId)
    const items = sectionItems.flatMap((item) => injectedSectionItem(item, t))
    if (items.length === 0) continue
    nextSections.push({ id: sectionId, label, items })
  }
  return nextSections
}

/** Segment-aware: an href covers its own path and the paths below it, never a sibling that merely shares its prefix. */
export function isPathOnBranch(pathname: string | null | undefined, href: string): boolean {
  if (!pathname || !href) return false
  if (pathname === href) return true
  const base = href.endsWith('/') ? href.slice(0, -1) : href
  return pathname.startsWith(`${base}/`)
}

function visibleItems(items: NavItem[]): NavItem[] {
  return items.filter((item) => item.hidden !== true)
}

/** Groups the module switcher lists: main-context pages only, empty groups dropped. */
export function selectModuleGroups(groups: NavGroup[], isSettingsHref: (href: string) => boolean): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: visibleItems(group.items).filter((item) => {
        if (item.pageContext && item.pageContext !== 'main') return false
        return !isSettingsHref(item.href)
      }),
    }))
    .filter((group) => group.items.length > 0)
}

/**
 * The group whose pages the current route belongs to — the one holding the
 * longest nav href on the route's branch. Longest wins, so when one module's
 * page sits under another module's path, each module still claims its own
 * routes.
 */
export function resolveActiveGroup(groups: NavGroup[], pathname: string | null | undefined): NavGroup | null {
  if (!pathname) return null
  let best: { group: NavGroup; length: number } | null = null
  for (const group of groups) {
    for (const item of group.items) {
      const candidates = [item, ...(item.children ?? [])]
      for (const candidate of candidates) {
        if (candidate.hidden === true || !isPathOnBranch(pathname, candidate.href)) continue
        if (!best || candidate.href.length > best.length) best = { group, length: candidate.href.length }
      }
    }
  }
  return best?.group ?? null
}

/** Where opening a module lands: its first reachable page. */
export function resolveGroupEntryHref(group: NavGroup): string | null {
  for (const item of group.items) {
    if (item.hidden === true) continue
    if (item.enabled !== false) return item.href
    const child = (item.children ?? []).find((entry) => entry.hidden !== true && entry.enabled !== false)
    if (child) return child.href
  }
  return null
}

export function groupToNavSection(group: NavGroup, fallbackIcon: React.ReactNode): ModuleNavSection {
  const toLink = (item: NavChildItem, children: NavChildItem[] = []): ModuleNavLink => ({
    key: item.id ?? item.href,
    href: item.href,
    label: item.title,
    icon: renderNavIcon(item.icon, item.iconName, item.iconMarkup, fallbackIcon),
    disabled: item.enabled === false,
    children: children.filter((child) => child.hidden !== true).map((child) => toLink(child)),
  })
  return {
    key: resolveGroupKey(group),
    label: null,
    links: visibleItems(group.items).map((item) => toLink(item, item.children)),
  }
}

export function sectionsToNavSections(
  sections: SectionNavGroup[],
  t: Translate,
  fallbackIcon: React.ReactNode,
): ModuleNavSection[] {
  const byOrder = <T extends { order?: number }>(entries: T[]) =>
    [...entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const toLink = (item: SectionNavItem): ModuleNavLink => ({
    key: item.id,
    href: item.href,
    label: item.labelKey ? t(item.labelKey, item.label) : item.label,
    icon: renderNavIcon(item.icon, item.iconName, item.iconMarkup, fallbackIcon),
    disabled: false,
    children: byOrder(item.children ?? []).map(toLink),
  })
  return byOrder(sections)
    .map((section) => ({
      key: `section:${section.id}`,
      label: section.labelKey ? t(section.labelKey, section.label) : section.label,
      links: byOrder(section.items).map(toLink),
    }))
    .filter((section) => section.links.length > 0)
}

/**
 * The one active link: the longest href on the route's branch. A parent stays
 * inactive while one of its subpages is the match, so exactly one row lights up.
 */
export function resolveActiveLinkKey(sections: ModuleNavSection[], pathname: string | null | undefined): string | null {
  const best = { key: null as string | null, length: -1 }
  const visit = (link: ModuleNavLink) => {
    if (isPathOnBranch(pathname, link.href) && link.href.length > best.length) {
      best.key = link.key
      best.length = link.href.length
    }
    link.children.forEach(visit)
  }
  sections.forEach((section) => section.links.forEach(visit))
  return best.key
}

export function matchesModuleQuery(group: NavGroup, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (group.name.toLowerCase().includes(needle)) return true
  return group.items.some((item) =>
    item.title.toLowerCase().includes(needle) ||
    (item.children ?? []).some((child) => child.title.toLowerCase().includes(needle)),
  )
}
