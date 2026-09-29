/**
 * Assignment Conflict Service
 *
 * Handles all conflict detection logic for resource assignments:
 * - Block checking (temporary unavailability)
 * - Availability rule checking (from Planner module)
 * - Confirmed assignment conflict checking
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { ResourcesAssignment, ResourcesBlock, ResourcesResource } from '../data/entities'
import { PlannerAvailabilityRule } from '@open-mercato/core/modules/planner/data/entities'
import { getMergedAvailabilityWindows } from '@open-mercato/core/modules/planner/lib/availabilityMerge'
import {
  loadOrganizationAvailabilityPolicy,
  resolveLatestNewBookingStart,
  resolveOrganizationAvailabilityWindows,
} from '@open-mercato/core/modules/planner/lib/organizationAvailability'

const DAY_MS = 24 * 60 * 60 * 1000

export interface ConflictCheckOptions {
  /** Assignment ID to exclude (e.g., when updating an existing assignment) */
  excludeAssignmentId?: string
  /** Source entity IDs to exclude (e.g., same booking's other lines for chaining) */
  excludeSourceEntityIds?: string[]
  /** Include draft assignments when a draft reserves a slot for its module. */
  includeDrafts?: boolean
}

export type AssignmentAvailabilityMode = 'resource' | 'appointment'

export interface ValidationResult {
  valid: boolean
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/**
 * Assignment Conflict Service
 *
 * Validates resource assignments against:
 * 1. Resource existence and active status
 * 2. Resource blocks (temporary unavailability)
 * 3. Availability rules (from Planner module)
 * 4. Confirmed assignment conflicts (double-booking prevention)
 */
export class AssignmentConflictService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Validate that a resource assignment can be created/updated
   * Returns validation result with error details if invalid
   */
  async validateAssignment(params: {
    tenantId: string
    organizationId: string
    resourceId: string
    startsAt: Date
    endsAt: Date
    excludeAssignmentId?: string
    excludeSourceEntityIds?: string[]
    organizationIds?: string[]
    includeDrafts?: boolean
    availabilityMode?: AssignmentAvailabilityMode
    availabilityAnchorStartAt?: Date
    isChainedService?: boolean
  }): Promise<ValidationResult> {
    // 0. Check the interval itself is well-formed
    // Every overlap test below is half-open `[start, end)` — `startsAt < otherEnd AND endsAt > otherStart`.
    // A reversed or zero-length interval satisfies neither side, so it would never conflict with anything
    // and nothing would ever conflict with it: the row would be written and stay permanently invisible to
    // double-booking detection while still rendering on the planner grid.
    if (!(params.endsAt.getTime() > params.startsAt.getTime())) {
      return {
        valid: false,
        error: { code: 'INVALID_INTERVAL', message: 'Assignment end must be after its start' },
      }
    }

    // 1. Check resource exists & is active
    const scopedOrganizationIds = params.organizationIds?.length ? params.organizationIds : [params.organizationId]
    const resource = await this.em.findOne(ResourcesResource, {
      id: params.resourceId,
      tenantId: params.tenantId,
      organizationId: { $in: scopedOrganizationIds },
    })
    if (!resource) {
      return this.checkResource(params.tenantId, params.organizationId, params.resourceId)
    }
    if (!resource.isActive) {
      return {
        valid: false,
        error: { code: 'RESOURCE_INACTIVE', message: 'Resource is not active' },
      }
    }

    const resourceOrganizationId = resource?.organizationId ?? params.organizationId

    // 2. Check blocks
    const blockCheck = await this.checkNoBlocks(params.tenantId, resourceOrganizationId, params.resourceId, params.startsAt, params.endsAt)
    if (!blockCheck.valid) {
      return blockCheck
    }

    // 3. Check availability rules
    const availabilityCheck = await this.checkWithinAvailability(
      params.resourceId,
      params.tenantId,
      resourceOrganizationId,
      params.startsAt,
      params.endsAt,
      params.availabilityMode,
      params.availabilityAnchorStartAt,
      [resourceOrganizationId, ...scopedOrganizationIds.filter((id) => id !== resourceOrganizationId)],
      params.isChainedService,
    )
    if (!availabilityCheck.valid) {
      return availabilityCheck
    }

    // 4. Check confirmed conflicts
    const conflictCheck = await this.checkNoConfirmedConflicts(
      params.resourceId,
      params.tenantId,
      undefined,
      params.startsAt,
      params.endsAt,
      {
        excludeAssignmentId: params.excludeAssignmentId,
        excludeSourceEntityIds: params.excludeSourceEntityIds,
        includeDrafts: params.includeDrafts,
      },
    )
    if (!conflictCheck.valid) {
      return conflictCheck
    }

    return { valid: true }
  }

  /**
   * Check that resource exists and is active
   */
  async checkResource(tenantId: string, organizationId: string, resourceId: string): Promise<ValidationResult> {
    const resource = await this.em.findOne(ResourcesResource, { id: resourceId, tenantId, organizationId })

    if (!resource) {
      return {
        valid: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Resource not found',
        },
      }
    }

    if (!resource.isActive) {
      return {
        valid: false,
        error: {
          code: 'RESOURCE_INACTIVE',
          message: 'Resource is not active',
        },
      }
    }

    return { valid: true }
  }

  /**
   * Check that resource is not blocked during the requested time
   */
  async checkNoBlocks(
    tenantId: string,
    organizationId: string,
    resourceId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<ValidationResult> {
    const blockCount = await this.em.count(ResourcesBlock, {
      tenantId,
      organizationId,
      resource: resourceId,
      startsAt: { $lt: endsAt },
      endsAt: { $gt: startsAt },
    })

    if (blockCount > 0) {
      return {
        valid: false,
        error: {
          code: 'RESOURCE_BLOCKED',
          message: 'Resource is blocked for this time range',
        },
      }
    }

    return { valid: true }
  }

  /**
   * Check that the requested time is within resource's availability rules
   */
  async checkWithinAvailability(
    resourceId: string,
    tenantId: string,
    organizationId: string,
    startsAt: Date,
    endsAt: Date,
    availabilityMode: AssignmentAvailabilityMode = 'resource',
    availabilityAnchorStartAt?: Date,
    organizationIds: string[] = [organizationId],
    isChainedService = false,
  ): Promise<ValidationResult> {
    const resource = await this.em.findOne(ResourcesResource, {
      id: resourceId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    const directRules = resource
      ? await this.em.find(PlannerAvailabilityRule, {
            tenantId,
            organizationId,
            subjectType: 'resource',
            subjectId: resourceId,
            deletedAt: null,
          })
      : []
    const ruleSetRules = resource?.availabilityRuleSetId
      ? await this.em.find(PlannerAvailabilityRule, {
                tenantId,
                organizationId,
                subjectType: 'ruleset',
                subjectId: resource.availabilityRuleSetId,
                deletedAt: null,
              })
      : []
    const rules = directRules.length > 0 ? directRules : ruleSetRules
    const availabilityRange = {
      start: new Date(startsAt.getTime() - DAY_MS),
      end: new Date(endsAt.getTime() + DAY_MS),
    }
    const resourceWindows = rules.length > 0
      ? getMergedAvailabilityWindows({
          rules: rules.map((rule) => ({
            id: rule.id,
            rrule: rule.rrule,
            exdates: rule.exdates,
            kind: rule.kind,
          })),
          range: availabilityRange,
      })
      : null
    const resourceRuleById = new Map(rules.map((rule) => [rule.id, rule]))
    const resourceWindowsWithRuntime = resourceWindows?.map((window) => {
      const rule = resourceRuleById.get(window.ruleId ?? '')
      const hasAcceptanceOverride = rule?.lastCustomerAcceptanceMinutes != null
        || rule?.lastCustomerBeforeCloseMinutes != null
      return {
        start: window.start,
        operatingEnd: window.end,
        runtimeEnd: new Date(window.end.getTime() + (rule?.timeOverflowMinutes ?? 0) * 60_000),
        overflowMinutes: rule?.timeOverflowMinutes ?? 0,
        rule,
        latestStartAt: rule && hasAcceptanceOverride
          ? resolveLatestNewBookingStart(window.end, rule, 0, rule.timezone)
          : window.end,
      }
    }) ?? null
    const policy = await loadOrganizationAvailabilityPolicy(this.em, {
      tenantId,
      organizationIds,
    })

    if (availabilityMode === 'appointment') {
      const organizationWindows = policy
        ? resolveOrganizationAvailabilityWindows(policy, availabilityRange)
        : null
      const usesOfficialRuleSet = Boolean(policy)
        && resource?.availabilityRuleSetId === policy?.operatingHoursRuleSetId
        && directRules.length === 0
      const hasCustomResourceAvailability = directRules.length > 0
        || Boolean(resource?.availabilityRuleSetId && !usesOfficialRuleSet)
      const appointmentResourceWindows = hasCustomResourceAvailability && organizationWindows && resourceWindowsWithRuntime
        ? resourceWindowsWithRuntime.flatMap((resourceWindow) => organizationWindows.flatMap((organizationWindow) => {
            const start = new Date(Math.max(resourceWindow.start.getTime(), organizationWindow.start.getTime()))
            const operatingEnd = new Date(Math.min(resourceWindow.operatingEnd.getTime(), organizationWindow.operatingEnd.getTime()))
            if (start >= operatingEnd) return []
            const hasCutoff = resourceWindow.rule && (
              resourceWindow.rule.lastCustomerAcceptanceMinutes != null
              || resourceWindow.rule.lastCustomerBeforeCloseMinutes != null
            )
            const configuredCutoff = hasCutoff && resourceWindow.rule
              ? resolveLatestNewBookingStart(operatingEnd, resourceWindow.rule, 0, resourceWindow.rule.timezone)
              : operatingEnd
            return [{
              start,
              operatingEnd,
              runtimeEnd: new Date(operatingEnd.getTime() + resourceWindow.overflowMinutes * 60_000),
              latestStartAt: new Date(Math.min(configuredCutoff.getTime(), operatingEnd.getTime())),
            }]
          }))
        : resourceWindowsWithRuntime
      const anchorStartAt = availabilityAnchorStartAt ?? startsAt
      const acceptanceCandidate = isChainedService ? anchorStartAt : startsAt
      const organizationStartWindow = hasCustomResourceAvailability || !organizationWindows || organizationWindows.some(
        (window) => window.start <= acceptanceCandidate && window.latestNewBookingStart >= acceptanceCandidate,
      )
      const organizationRuntimeWindow = hasCustomResourceAvailability || !organizationWindows || organizationWindows.some(
        (window) => window.start <= startsAt && window.end >= endsAt,
      )
      const hasResourceStartWindow = appointmentResourceWindows?.some((window) => (
        window.start <= startsAt
        && window.runtimeEnd >= endsAt
        && (isChainedService || startsAt <= window.operatingEnd)
      ))
      const hasResourceAcceptanceWindow = appointmentResourceWindows?.some((window) => (
        window.start <= startsAt
        && window.runtimeEnd >= endsAt
        && (isChainedService || startsAt <= window.operatingEnd)
        && (isChainedService || startsAt <= (window.latestStartAt ?? window.operatingEnd))
      ))
      const hasValidResourceWindow = appointmentResourceWindows?.some((window) => {
        const serviceFitsRuntime = window.start <= startsAt && window.runtimeEnd >= endsAt
        const serviceStartsWithinOperatingHours = isChainedService || startsAt <= window.operatingEnd
        const bookingStartsBeforeCutoff = isChainedService || startsAt <= (window.latestStartAt ?? window.operatingEnd)
        return serviceFitsRuntime && serviceStartsWithinOperatingHours && bookingStartsBeforeCutoff
      })
      const resourceAcceptanceWindow = !hasCustomResourceAvailability || Boolean(hasResourceAcceptanceWindow)
      const resourceRuntimeWindow = !hasCustomResourceAvailability || Boolean(hasValidResourceWindow)
      const resourceStartWindow = !hasCustomResourceAvailability || Boolean(hasResourceStartWindow)

      const startsAfterAnchor = !availabilityAnchorStartAt || startsAt >= availabilityAnchorStartAt
      if (!organizationStartWindow || !organizationRuntimeWindow || !resourceStartWindow || !resourceAcceptanceWindow || !startsAfterAnchor || !resourceRuntimeWindow) {
        return {
          valid: false,
          error: {
            code: 'OUTSIDE_AVAILABILITY',
            message: resourceAcceptanceWindow
              ? 'Requested time is outside resource availability hours'
              : 'Requested start is after the resource last customer cutoff',
            details: {
              requestedStart: startsAt.toISOString(),
              requestedEnd: endsAt.toISOString(),
              availableWindows: (organizationWindows ?? []).map((window) => ({
                start: window.start.toISOString(),
                end: window.end.toISOString(),
              })),
            },
          },
        }
      }

      return { valid: true }
    }

    const windows = resourceWindows

    if (!windows) return { valid: true }

    // Check if there's a window that contains the entire requested range
    const hasOverlap = windows.some(
      (window) => window.start <= startsAt && window.end >= endsAt,
    )

    if (!hasOverlap) {
      return {
        valid: false,
        error: {
          code: 'OUTSIDE_AVAILABILITY',
          message: 'Requested time is outside resource availability hours',
          details: {
            requestedStart: startsAt.toISOString(),
            requestedEnd: endsAt.toISOString(),
            availableWindows: windows.map((w) => ({
              start: w.start.toISOString(),
              end: w.end.toISOString(),
            })),
          },
        },
      }
    }

    return { valid: true }
  }

  /**
   * Check that there are no conflicting assignments.
   * Draft conflicts are opt-in because some generic modules use drafts as a preview.
   */
  async checkNoConfirmedConflicts(
    resourceId: string,
    tenantId: string,
    organizationId: string | undefined,
    startsAt: Date,
    endsAt: Date,
    options?: ConflictCheckOptions,
  ): Promise<ValidationResult> {
    const where: Record<string, unknown> = {
      tenantId,
      resource: resourceId,
      cancelledAt: null,
      startsAt: { $lt: endsAt },
      endsAt: { $gt: startsAt },
    }

    if (organizationId) where.organizationId = organizationId
    if (!options?.includeDrafts) where.state = 'confirmed'

    if (options?.excludeAssignmentId) {
      where.id = { $ne: options.excludeAssignmentId }
    }

    if (options?.excludeSourceEntityIds && options.excludeSourceEntityIds.length > 0) {
      where.sourceEntityId = { $nin: options.excludeSourceEntityIds }
    }

    const conflictCount = await this.em.count(ResourcesAssignment, where)

    if (conflictCount > 0) {
      return {
        valid: false,
        error: {
          code: 'ASSIGNMENT_CONFLICT',
          message: 'Resource is already booked for this time',
        },
      }
    }

    return { valid: true }
  }

  /**
   * Get all conflicting assignments for a time range
   * Useful for displaying conflicts to users
   */
  async getConflictingAssignments(params: {
    tenantId: string
    organizationId: string
    resourceId: string
    startsAt: Date
    endsAt: Date
    excludeAssignmentId?: string
    excludeSourceEntityIds?: string[]
  }): Promise<ResourcesAssignment[]> {
    const where: Record<string, unknown> = {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      resource: params.resourceId,
      state: 'confirmed',
      cancelledAt: null,
      startsAt: { $lt: params.endsAt },
      endsAt: { $gt: params.startsAt },
    }

    if (params.excludeAssignmentId) {
      where.id = { $ne: params.excludeAssignmentId }
    }

    if (params.excludeSourceEntityIds && params.excludeSourceEntityIds.length > 0) {
      where.sourceEntityId = { $nin: params.excludeSourceEntityIds }
    }

    return this.em.find(ResourcesAssignment, where, {
      orderBy: { startsAt: 'asc' },
    })
  }
}
