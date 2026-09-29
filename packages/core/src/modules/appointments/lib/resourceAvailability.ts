import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ResourcesResource } from '@open-mercato/core/modules/resources/data/entities'
import { PlannerAvailabilityRule } from '@open-mercato/core/modules/planner/data/entities'
import { getMergedAvailabilityWindows } from '@open-mercato/core/modules/planner/lib/availabilityMerge'
import {
  loadOrganizationAvailabilityPolicy,
  resolveLatestNewBookingStart,
  resolveOrganizationAvailabilityWindows,
} from '@open-mercato/core/modules/planner/lib/organizationAvailability'

export type ResourceAvailabilityWindow = {
  startsAt: string
  endsAt: string
  latestStartAt?: string
}

function resolveResourceWindowsWithOverrides(
  windows: Array<{ start: Date; end: Date; ruleId?: string }>,
  rules: PlannerAvailabilityRule[],
) {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]))
  return windows.map((window) => {
    const rule = rulesById.get(window.ruleId ?? '')
    const overflowMinutes = rule?.timeOverflowMinutes ?? 0
    const hasAcceptanceOverride = rule?.lastCustomerAcceptanceMinutes != null
      || rule?.lastCustomerBeforeCloseMinutes != null
    return {
      start: window.start,
      operatingEnd: window.end,
      end: new Date(window.end.getTime() + overflowMinutes * 60_000),
      latestStartAt: rule && hasAcceptanceOverride
        ? resolveLatestNewBookingStart(window.end, rule, 0, rule.timezone)
        : overflowMinutes > 0
          ? window.end
          : null,
    }
  })
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
  await Promise.all(resourceRecords.map(async (resource) => {
    const directResourceRules = rulesBySubjectId.get(resource.id) ?? []
    const linkedRuleSetRules = resource.availabilityRuleSetId
      ? rulesBySubjectId.get(resource.availabilityRuleSetId) ?? []
      : []
    const resourceRules = directResourceRules.length > 0 ? directResourceRules : linkedRuleSetRules
    const rawResourceWindows = resourceRules.length > 0
      ? getMergedAvailabilityWindows({
          rules: resourceRules.map((rule) => ({
            id: rule.id,
            rrule: rule.rrule,
            exdates: rule.exdates,
            kind: rule.kind,
          })),
          range: params.range,
        })
      : null
    const resourceWindows = rawResourceWindows
      ? resolveResourceWindowsWithOverrides(rawResourceWindows, resourceRules)
      : null

    const orderedOrganizationIds = [
      resource.organizationId,
      ...params.organizationIds.filter((organizationId) => organizationId !== resource.organizationId),
    ]
    const policy = await loadOrganizationAvailabilityPolicy(em, {
      tenantId: params.tenantId,
      organizationIds: orderedOrganizationIds,
    })
    if (!policy) {
      const hasCustomResourceAvailability = directResourceRules.length > 0 || Boolean(resource.availabilityRuleSetId)
      windowsByResourceId.set(
        resource.id,
        resourceWindows?.map((window) => ({
          startsAt: window.start.toISOString(),
          endsAt: window.end.toISOString(),
          ...(window.latestStartAt ? { latestStartAt: window.latestStartAt.toISOString() } : {}),
        })) ?? (hasCustomResourceAvailability ? [] : null),
      )
      return
    }

    const organizationWindows = resolveOrganizationAvailabilityWindows(policy, params.range)
    const usesOfficialRuleSet = resource.availabilityRuleSetId === policy.operatingHoursRuleSetId
      && directResourceRules.length === 0
    const hasCustomResourceAvailability = directResourceRules.length > 0
      || Boolean(resource.availabilityRuleSetId && !usesOfficialRuleSet)
    const effectiveWindows = usesOfficialRuleSet
      ? organizationWindows.map((window) => ({
          start: window.start,
          end: window.end,
          latestStartAt: null,
        }))
      : hasCustomResourceAvailability
        ? (resourceWindows ?? []).map((window) => ({
            start: window.start,
            end: window.end,
            latestStartAt: window.latestStartAt ?? window.operatingEnd,
          }))
      : organizationWindows.map((window) => ({
          start: window.start,
          end: window.end,
          latestStartAt: null,
        }))
    windowsByResourceId.set(
      resource.id,
      effectiveWindows.map((window) => ({
        startsAt: window.start.toISOString(),
        endsAt: window.end.toISOString(),
        ...(window.latestStartAt ? { latestStartAt: window.latestStartAt.toISOString() } : {}),
      })),
    )
  }))

  return windowsByResourceId
}
