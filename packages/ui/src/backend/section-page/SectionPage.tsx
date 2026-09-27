'use client'
import * as React from 'react'
import { ModuleLayout } from '../module-nav/ModuleSidebar'
import { SectionNav } from './SectionNav'
import type { SectionPageProps } from './types'

/** A page beside its section sidebar, drawn with the module sidebar every module uses. */
export function SectionPage({
  title,
  titleKey,
  sections,
  activePath,
  userFeatures,
  children,
}: SectionPageProps) {
  const [collapsed, setCollapsed] = React.useState(false)

  return (
    <ModuleLayout
      collapsed={collapsed}
      sidebar={(
        <SectionNav
          title={title}
          titleKey={titleKey}
          sections={sections}
          activePath={activePath}
          userFeatures={userFeatures}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        />
      )}
    >
      {children}
    </ModuleLayout>
  )
}
