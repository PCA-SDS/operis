"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { formatTabCount } from './utils'
import { TabsPanel } from '@open-mercato/ui/primitives/tabs'
import { RecordTabsBar, type RecordTab } from './RecordTabsBar'

export type DealTabId =
  | 'activities'
  | 'people'
  | 'companies'
  | 'notes'
  | 'files'
  | 'changelog'
  | string

type TabDef = RecordTab & { id: DealTabId }

export const DEAL_DETAIL_TABS_COMPONENT_ID = 'section:customers.deals.detailTabs'

export type DealDetailTabsProps = {
  activeTab: DealTabId
  onTabChange: (tab: DealTabId) => void
  injectedTabs?: Array<{ id: string; label: string }>
  hiddenTabIds?: string[]
  peopleCount?: number
  companiesCount?: number
  children: React.ReactNode
}

const SUPPORTED_TAB_IDS = new Set<DealTabId>(['activities', 'people', 'companies', 'notes', 'files', 'changelog'])

export function resolveLegacyTab(tab: string | null | undefined, knownTabIds?: Iterable<string>): DealTabId {
  if (!tab) return 'activities'
  if (SUPPORTED_TAB_IDS.has(tab as DealTabId)) return tab as DealTabId
  if (knownTabIds && new Set(knownTabIds).has(tab)) return tab
  return 'activities'
}

function DefaultDealDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  hiddenTabIds = [],
  peopleCount = 0,
  companiesCount = 0,
  children,
}: DealDetailTabsProps) {
  const t = useT()

  const builtInTabs = React.useMemo<TabDef[]>(
    () => [
      {
        id: 'activities',
        label: t('customers.deals.detail.tabs.activities', 'Activities'),
      },
      {
        id: 'people',
        label: t('customers.deals.detail.tabs.people', 'People'),
        count: formatTabCount(peopleCount),
      },
      {
        id: 'companies',
        label: t('customers.deals.detail.tabs.companies', 'Companies'),
        count: formatTabCount(companiesCount),
      },
      {
        id: 'notes',
        label: t('customers.deals.detail.tabs.notes', 'Notes'),
      },
      {
        id: 'files',
        label: t('customers.deals.detail.tabs.files', 'Files'),
      },
      {
        id: 'changelog',
        label: t('customers.deals.detail.tabs.changelog', 'Changelog'),
      },
    ],
    [companiesCount, peopleCount, t],
  )

  const allTabs = React.useMemo<TabDef[]>(() => {
    const hidden = new Set(hiddenTabIds)
    return [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as DealTabId,
        label: tab.label,
      })),
    ].filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  return (
    <div>
      <RecordTabsBar
        tabs={allTabs}
        activeTab={activeTab}
        onTabChange={(tab) => onTabChange(tab as DealTabId)}
        ariaLabel={t('customers.deals.detail.tabs.label', 'Deal detail sections')}
      />
      <TabsPanel value={activeTab} className="pt-5">
        {children}
      </TabsPanel>
    </div>
  )
}

registerComponent<DealDetailTabsProps>({
  id: DEAL_DETAIL_TABS_COMPONENT_ID,
  component: DefaultDealDetailTabs,
  metadata: {
    module: 'customers',
    description: 'Deal detail tab navigation and content.',
  },
})

export function DealDetailTabs(props: DealDetailTabsProps) {
  const ResolvedTabs = useRegisteredComponent<DealDetailTabsProps>(
    DEAL_DETAIL_TABS_COMPONENT_ID,
    DefaultDealDetailTabs,
  )
  return <ResolvedTabs {...props} />
}
