'use client'
import * as React from 'react'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SectionNavGroup, SectionNavItem } from './types'
import {
  ModuleSidebar,
  ModuleSidebarDivider,
  ModuleSidebarLink,
  ModuleSidebarSectionLabel,
} from '../module-nav/ModuleSidebar'
import { mergeMenuItems } from '../injection/mergeMenuItems'
import { useInjectedMenuItems, type MenuSurfaceId } from '../injection/useInjectedMenuItems'
import { resolveInjectedIcon } from '../injection/resolveInjectedIcon'

const DefaultIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

export type SectionNavProps = {
  title: string
  titleKey?: string
  sections: SectionNavGroup[]
  activePath: string
  userFeatures?: Set<string>
  collapsed: boolean
  onToggleCollapse: () => void
  menuSurfaceId?: MenuSurfaceId
}

export function SectionNav({
  title,
  titleKey,
  sections,
  activePath,
  userFeatures,
  collapsed,
  onToggleCollapse,
  menuSurfaceId,
}: SectionNavProps) {
  const t = useT()
  const { items: injectedMenuItems } = useInjectedMenuItems(menuSurfaceId ?? 'menu:sidebar:settings')
  const grantedFeatureList = React.useMemo(() => (userFeatures ? Array.from(userFeatures) : []), [userFeatures])

  const hasRequiredFeatures = (item: SectionNavItem): boolean => {
    if (!item.requireFeatures || item.requireFeatures.length === 0) return true
    if (!userFeatures) return true
    return hasAllFeatures(grantedFeatureList, item.requireFeatures)
  }

  const resolvedTitle = titleKey ? t(titleKey, title) : title

  const renderItem = (item: SectionNavItem) => {
    const isActive = activePath === item.href || activePath.startsWith(item.href + '/')
    const label = item.labelKey ? t(item.labelKey, item.label) : item.label
    return (
      <ModuleSidebarLink
        key={item.id}
        href={item.href}
        icon={item.icon ?? DefaultIcon}
        label={label}
        active={isActive}
      />
    )
  }

  const visibleSections = [...sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((section: SectionNavGroup) => {
      const sectionInjected = injectedMenuItems.filter((item) => (item.groupId ?? section.id) === section.id)
      const mergedItems = mergeMenuItems(
        section.items.map((item) => ({ id: item.id, item })),
        sectionInjected,
      ).flatMap((item) => {
        if (item.source === 'built-in') {
          const original = section.items.find((entry) => entry.id === item.id)
          return original ? [original] : []
        }
        if (!item.href) return []
        return [{
          id: item.id,
          label: item.labelKey ? t(item.labelKey, item.label ?? item.id) : (item.label ?? item.id),
          href: item.href,
          icon: resolveInjectedIcon(item.icon) ?? undefined,
        }]
      })
      const visibleItems = mergedItems.filter(hasRequiredFeatures)
      if (visibleItems.length === 0) return []
      const sortedItems = [...visibleItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const sectionLabel = section.labelKey ? t(section.labelKey, section.label) : section.label
      return [{ id: section.id, label: sectionLabel, items: sortedItems }]
    })

  return (
    <ModuleSidebar
      label={resolvedTitle}
      title={resolvedTitle}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      toggleLabels={{ collapse: t('common.collapse', 'Collapse'), expand: t('common.expand', 'Expand') }}
    >
      {visibleSections.map((section, index) => (
        <React.Fragment key={section.id}>
          {index > 0 ? <ModuleSidebarDivider /> : null}
          <ModuleSidebarSectionLabel>{section.label}</ModuleSidebarSectionLabel>
          {section.items.map(renderItem)}
        </React.Fragment>
      ))}
    </ModuleSidebar>
  )
}
