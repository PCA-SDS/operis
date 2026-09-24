import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ResourcesResource } from '@open-mercato/core/modules/resources/data/entities'
import { PlannerAvailabilityRule } from '@open-mercato/core/modules/planner/data/entities'
import { getMergedAvailabilityWindows } from '@open-mercato/core/modules/planner/lib/availabilityMerge'

export type ResourceAvailabilityWindow = {
  startsAt: string
  endsAt: string
}

export async function resolveResourceOrganizationIds(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<string[]> {
  const organization = await em.findOne(Organization, {
    id: organizationId,
    tenant: tenantId,
    deletedAt: null,
  })
  return Array.from(new Set([organizationId, ...(organization?.ancestorIds ?? [])]))
}

export async function loadResourceAvailabilityWindows(
  em: EntityManager,
  params: {
    tenantId: string
    organizationIds: string[]
    resourceIds: string[]
    range: { start: Date; end: Date }
  },
): Promise<Map<string, ResourceAvailabilityWindow[] | null>> {
  if (params.resourceIds.length === 0) return new Map()

  const resourceRecords = await em.find(ResourcesResource, {
    id: { $in: params.resourceIds },
    tenantId: params.tenantId,
    organizationId: { $in: params.organizationIds },
    deletedAt: null,
  })
  const resourceRuleSetIds = resourceRecords
    .map((resource) => resource.availabilityRuleSetId)
    .filter((ruleSetId): ruleSetId is string => Boolean(ruleSetId))
  const [resourceAvailabilityRules, ruleSetAvailabilityRules] = await Promise.all([
    em.find(PlannerAvailabilityRule, {
      tenantId: params.tenantId,
      organizationId: { $in: params.organizationIds },
      subjectType: 'resource',
      subjectId: { $in: params.resourceIds },
      deletedAt: null,
    }),
    resourceRuleSetIds.length > 0
      ? em.find(PlannerAvailabilityRule, {
          tenantId: params.tenantId,
          organizationId: { $in: params.organizationIds },
          subjectType: 'ruleset',
          subjectId: { $in: resourceRuleSetIds },
          deletedAt: null,
        })
      : Promise.resolve([]),
  ])
  const rulesBySubjectId = new Map<string, PlannerAvailabilityRule[]>()
  for (const rule of [...resourceAvailabilityRules, ...ruleSetAvailabilityRules]) {
    rulesBySubjectId.set(rule.subjectId, [...(rulesBySubjectId.get(rule.subjectId) ?? []), rule])
  }

  const windowsByResourceId = new Map<string, ResourceAvailabilityWindow[] | null>()
  for (const resource of resourceRecords) {
    const rules = [
      ...(rulesBySubjectId.get(resource.id) ?? []),
      ...(resource.availabilityRuleSetId ? rulesBySubjectId.get(resource.availabilityRuleSetId) ?? [] : []),
    ]
    const windows = resource.availabilityRuleSetId && rules.length > 0
      ? getMergedAvailabilityWindows({
          rules: rules.map((rule) => ({
            id: rule.id,
            rrule: rule.rrule,
            exdates: rule.exdates,
            kind: rule.kind,
          })),
          range: params.range,
        }).map((window) => ({ startsAt: window.start.toISOString(), endsAt: window.end.toISOString() }))
      : null
    windowsByResourceId.set(resource.id, windows)
  }

  return windowsByResourceId
}
