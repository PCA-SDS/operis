"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { useDealsAccess } from './useDealsAccess'
import { formatTabCount } from './utils'
import { TabsPanel } from '@open-mercato/ui/primitives/tabs'
import { RecordTabsBar, type RecordTab } from './RecordTabsBar'

export type CompanyTabId =
  | 'people'
  | 'deals'
  | 'addresses'
  | 'activity-log'
  | 'changelog'
  | 'files'
  | string

type TabDef = RecordTab & { id: CompanyTabId }

export const COMPANY_DETAIL_TABS_COMPONENT_ID = 'section:customers.companies.detailTabs'

export type CompanyDetailTabsProps = {
  activeTab: CompanyTabId
  onTabChange: (tab: CompanyTabId) => void
  injectedTabs?: Array<{ id: string; label: string; priority?: number }>
  hiddenTabIds?: string[]
  peopleCount?: number
  dealsCount?: number
  addressesCount?: number
  activitiesCount?: number
  filesCount?: number
  sectionAction?: SectionAction | null
  children: React.ReactNode
}

const LEGACY_TAB_MAP: Record<string, CompanyTabId> = {
  notes: 'people',
  activities: 'activity-log',
  tasks: 'people',
  dashboard: 'people',
  'dane-firmy': 'people',
  analysis: 'people',
}

export function resolveLegacyTab(tab: string | null | undefined): CompanyTabId {
  if (!tab) return 'people'
  if (LEGACY_TAB_MAP[tab]) return LEGACY_TAB_MAP[tab]
  return tab as CompanyTabId
}

function DefaultCompanyDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  hiddenTabIds = [],
  peopleCount = 0,
  dealsCount = 0,
  addressesCount = 0,
  activitiesCount = 0,
  filesCount = 0,
  sectionAction = null,
  children,
}: CompanyDetailTabsProps) {
  const t = useT()
  const { canViewDeals } = useDealsAccess()

  const builtInTabs: TabDef[] = React.useMemo(
    () => [
      {
        id: 'people',
        label: t('customers.companies.detail.tabs.people', 'People'),
        count: formatTabCount(peopleCount),
      },
      ...(canViewDeals
        ? [
            {
              id: 'deals' as CompanyTabId,
              label: t('customers.companies.detail.tabs.deals', 'Deals'),
              count: formatTabCount(dealsCount),
            },
          ]
        : []),
      {
        id: 'addresses',
        label: t('customers.companies.detail.tabs.addresses', 'Addresses'),
        count: formatTabCount(addressesCount),
      },
      {
        id: 'activity-log',
        label: t('customers.companies.detail.tabs.activityLog', 'Activity log'),
        count: formatTabCount(activitiesCount),
      },
      {
        id: 'changelog',
        label: t('customers.companies.detail.tabs.changelog', 'Changelog'),
      },
      {
        id: 'files',
        label: t('customers.companies.detail.tabs.files', 'Files'),
        count: formatTabCount(filesCount),
      },
    ],
    [t, canViewDeals, peopleCount, dealsCount, addressesCount, activitiesCount, filesCount],
  )

  const allTabs: TabDef[] = React.useMemo(() => {
    const hidden = new Set(hiddenTabIds)
    return [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as CompanyTabId,
        label: tab.label,
      })),
    ].filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  return (
    <div>
      <RecordTabsBar
        tabs={allTabs}
        activeTab={activeTab}
        onTabChange={(tab) => onTabChange(tab as CompanyTabId)}
        ariaLabel={t('customers.companies.detail.tabs.label', 'Company detail sections')}
        sectionAction={sectionAction}
      />
      <TabsPanel value={activeTab} className="pt-6">
        {children}
      </TabsPanel>
    </div>
  )
}

registerComponent<CompanyDetailTabsProps>({
  id: COMPANY_DETAIL_TABS_COMPONENT_ID,
  component: DefaultCompanyDetailTabs,
  metadata: {
    module: 'customers',
    description: 'Company detail tab navigation and content.',
  },
})

export function CompanyDetailTabs(props: CompanyDetailTabsProps) {
  const ResolvedTabs = useRegisteredComponent<CompanyDetailTabsProps>(
    COMPANY_DETAIL_TABS_COMPONENT_ID,
    DefaultCompanyDetailTabs,
  )
  return <ResolvedTabs {...props} />
}
