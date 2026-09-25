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
    const rules = [...directRules, ...ruleSetRules]
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
    const policy = await loadOrganizationAvailabilityPolicy(this.em, {
      tenantId,
      organizationIds: [organizationId],
    })

    if (availabilityMode === 'appointment' && policy) {
      const organizationWindows = resolveOrganizationAvailabilityWindows(policy, availabilityRange)
      const anchorStartAt = availabilityAnchorStartAt ?? startsAt
      const organizationStartWindow = organizationWindows.some(
        (window) => window.start <= anchorStartAt && window.latestNewBookingStart >= anchorStartAt,
      )
      const organizationRuntimeWindow = organizationWindows.some(
        (window) => window.start <= startsAt && window.end >= endsAt,
      )
      const usesOfficialRuleSet = resource?.availabilityRuleSetId === policy.operatingHoursRuleSetId && directRules.length === 0
      const resourceStartWindow = usesOfficialRuleSet || !resourceWindows || resourceWindows.some(
        (window) => window.start <= startsAt && window.end >= startsAt,
      )
      const resourceRuntimeWindow = !resourceWindows || resourceWindows.some(
        (window) => window.start <= startsAt && window.end >= endsAt,
      )

      const startsAfterAnchor = !availabilityAnchorStartAt || startsAt >= availabilityAnchorStartAt
      if (!organizationStartWindow || !organizationRuntimeWindow || !resourceStartWindow || !startsAfterAnchor || (!usesOfficialRuleSet && !resourceRuntimeWindow)) {
        return {
          valid: false,
          error: {
            code: 'OUTSIDE_AVAILABILITY',
            message: 'Requested time is outside resource availability hours',
            details: {
              requestedStart: startsAt.toISOString(),
              requestedEnd: endsAt.toISOString(),
              availableWindows: organizationWindows.map((window) => ({
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
