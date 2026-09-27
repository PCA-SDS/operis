"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { useDealsAccess } from './useDealsAccess'
import { formatTabCount } from './utils'
import { RecordTabsBar, type RecordTab } from './RecordTabsBar'

export type PersonTabId =
  | 'activities'
  | 'emails'
  | 'deals'
  | 'companies'
  | 'addresses'
  | 'tasks'
  | 'changelog'
  | 'files'
  | string

type TabDef = RecordTab & { id: PersonTabId }

export const PERSON_DETAIL_TABS_COMPONENT_ID = 'section:customers.people.detailTabs'

export type PersonDetailTabsProps = {
  activeTab: PersonTabId
  onTabChange: (tab: PersonTabId) => void
  injectedTabs?: Array<{ id: string; label: string }>
  hiddenTabIds?: string[]
  activitiesCount?: number
  dealsCount?: number
  companiesCount?: number
  addressesCount?: number
  tasksCount?: number
  filesCount?: number
  sectionAction?: SectionAction | null
  children: React.ReactNode
}

const SUPPORTED_TAB_IDS = new Set<PersonTabId>(['activities', 'emails', 'deals', 'companies', 'addresses', 'tasks', 'changelog', 'files'])

export function resolveLegacyTab(tab: string | null | undefined, knownTabIds?: Iterable<string>): PersonTabId {
  if (!tab) return 'activities'
  if (SUPPORTED_TAB_IDS.has(tab as PersonTabId)) return tab as PersonTabId
  if (knownTabIds && new Set(knownTabIds).has(tab)) return tab
  return 'activities'
}

function DefaultPersonDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  hiddenTabIds = [],
  activitiesCount = 0,
  dealsCount = 0,
  companiesCount = 0,
  addressesCount = 0,
  tasksCount = 0,
  filesCount = 0,
  sectionAction = null,
  children,
}: PersonDetailTabsProps) {
  const t = useT()
  const { canViewDeals } = useDealsAccess()

  const builtInTabs: TabDef[] = React.useMemo(
    () => [
      {
        id: 'activities',
        label: t('customers.people.detail.tabs.activities', 'Activities'),
        count: formatTabCount(activitiesCount),
      },
      {
        id: 'emails',
        label: t('customers.people.detail.tabs.emails', 'Emails'),
      },
      ...(canViewDeals
        ? [
            {
              id: 'deals' as PersonTabId,
              label: t('customers.people.detail.tabs.deals', 'Deals'),
              count: formatTabCount(dealsCount),
            },
          ]
        : []),
      {
        id: 'companies',
        label: t('customers.people.detail.tabs.companies', 'Companies'),
        count: formatTabCount(companiesCount),
      },
      {
        id: 'addresses',
        label: t('customers.people.detail.tabs.addresses', 'Addresses'),
        count: formatTabCount(addressesCount),
      },
      {
        id: 'tasks',
        label: t('customers.people.detail.tabs.tasks', 'Tasks'),
        count: formatTabCount(tasksCount),
      },
      {
        id: 'changelog',
        label: t('customers.people.detail.tabs.changelog', 'Change log'),
      },
      {
        id: 'files',
        label: t('customers.people.detail.tabs.files', 'Files'),
        count: formatTabCount(filesCount),
      },
    ],
    [t, canViewDeals, activitiesCount, dealsCount, companiesCount, addressesCount, tasksCount, filesCount],
  )

  const allTabs: TabDef[] = React.useMemo(() => {
    const hidden = new Set(hiddenTabIds)
    return [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as PersonTabId,
        label: tab.label,
      })),
    ].filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  return (
    <div>
      <RecordTabsBar
        tabs={allTabs}
        activeTab={activeTab}
        onTabChange={(tab) => onTabChange(tab as PersonTabId)}
        ariaLabel={t('customers.people.detail.tabs.label', 'Person detail sections')}
        sectionAction={sectionAction}
      />
      <div className="pt-6">
        {children}
      </div>
    </div>
  )
}

registerComponent<PersonDetailTabsProps>({
  id: PERSON_DETAIL_TABS_COMPONENT_ID,
  component: DefaultPersonDetailTabs,
  metadata: {
    module: 'customers',
    description: 'Person detail tab navigation and content.',
  },
})

export function PersonDetailTabs(props: PersonDetailTabsProps) {
  const ResolvedTabs = useRegisteredComponent<PersonDetailTabsProps>(
    PERSON_DETAIL_TABS_COMPONENT_ID,
    DefaultPersonDetailTabs,
  )
  return <ResolvedTabs {...props} />
}
