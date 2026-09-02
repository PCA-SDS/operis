"use client"

import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildOrgForest, type OrgChartNode } from '@open-mercato/core/modules/staff/lib/orgChart'

type OrgMember = {
  memberId: string
  userId: string | null
  displayName: string
  isActive: boolean
}

type OrgRole = {
  id: string
  name: string
  parentRoleId: string | null
  members: OrgMember[]
}

type OrgStructure = {
  roles: OrgRole[]
  unassigned: OrgMember[]
}

type RoleNode = OrgChartNode<OrgRole>

function MemberChip({ member }: { member: OrgMember }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-foreground"
      title={member.displayName}
    >
      <Avatar size="xs" label={member.displayName} />
      <span className="max-w-40 truncate">{member.displayName}</span>
    </span>
  )
}

function RoleBranch({ node, depth }: { node: RoleNode; depth: number }) {
  const t = useT()
  return (
    <li className="flex flex-col gap-2">
      <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{node.name}</span>
          <Badge variant="secondary" size="sm">
            {t('staff.orgChart.memberCount', '{count} people', { count: node.members.length })}
          </Badge>
        </div>
        {node.members.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {node.members.map((member) => (
              <MemberChip key={`${node.id}:${member.memberId}`} member={member} />
            ))}
          </div>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        // The rail is what makes the reporting line readable at a glance; the
        // indent alone does not carry it once a branch runs deep.
        <ul className="ms-4 flex flex-col gap-2 border-s border-border ps-4">
          {node.children.map((child) => (
            <RoleBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default function StaffOrgChartPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [structure, setStructure] = React.useState<OrgStructure | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    readApiResultOrThrow<OrgStructure>('/api/staff/org-structure')
      .then((result) => { if (!cancelled) setStructure(result) })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [scopeVersion])

  const forest = React.useMemo(() => buildOrgForest(structure?.roles ?? []), [structure])

  return (
    <Page>
      <PageHeader
        title={t('staff.orgChart.page.title', 'Organisation chart')}
        description={t('staff.orgChart.page.description', 'Who reports where, by the role they hold.')}
      />
      <PageBody>
        {isLoading ? (
          <LoadingMessage label={t('staff.orgChart.loading', 'Loading organisation chart…')} />
        ) : loadError ? (
          <ErrorMessage label={loadError} />
        ) : forest.length === 0 ? (
          <TabEmptyState
            title={t('staff.orgChart.empty', 'No roles to chart yet')}
            description={t('staff.orgChart.emptyHint', 'Give roles a parent role to build the reporting tree.')}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <ul className="flex flex-col gap-3">
              {forest.map((node) => (
                <RoleBranch key={node.id} node={node} depth={0} />
              ))}
            </ul>
            {structure && structure.unassigned.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('staff.orgChart.unassigned', 'Not placed')}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t('staff.orgChart.unassignedHint', 'Members who hold no role in this tenant.')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {structure.unassigned.map((member) => (
                    <MemberChip key={member.memberId} member={member} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
