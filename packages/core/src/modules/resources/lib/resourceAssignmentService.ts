/**
 * Resource Assignment Service
 *
 * Generic service for managing resource assignments across different modules
 * (appointments, WMS, tasks, etc.)
 *
 * Features:
 * - Draft/Confirmed state management
 * - Conflict detection with availability rules
 * - Automatic cancellation of overwritten assignments
 * - Staff assignment support
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { assign } from '@mikro-orm/core'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  ResourcesAssignment,
  ResourcesResource,
  ResourcesResourceArea,
  ResourcesResourceType,
} from '../data/entities'
import { AssignmentConflictService, type AssignmentAvailabilityMode } from './assignmentConflict'

export interface AssignmentUpsertParams {
  // Identity
  tenantId: string
  organizationId: string
  sourceModule: string
  sourceEntityType: string
  sourceEntityId: string

  // Assignment details
  resourceId: string
  startsAt: Date
  endsAt: Date
  assignedMemberId?: string | null
  assignedMemberIds?: string[]
  title?: string
  organizationIds?: string[]
  availabilityMode?: AssignmentAvailabilityMode
  availabilityAnchorStartAt?: Date

  // Conflict exclusion (e.g., same booking's other lines can stack)
  excludeSourceEntityIds?: string[]
  includeDraftConflicts?: boolean
  preserveState?: boolean

  // Audit
  userId?: string | null
  expectedUpdatedAt?: string
}

export interface AssignmentDTO {
  id: string
  resourceId: string
  resourceName?: string | null
  state: 'draft' | 'confirmed'
  startsAt: string
  endsAt: string
  assignedMemberId?: string | null
  assignedMemberIds: string[]
  assignedMemberNames?: string[]
  assignedMemberName?: string | null
  title?: string | null
  sourceModule: string
  sourceEntityType: string
  sourceEntityId: string
  createdAt: string
  updatedAt: string
}

export interface AssignmentWorkspace {
  resources: Array<{
    id: string
    name: string
    code?: string | null
    appearanceIcon?: string | null
    capacityUnitIcon?: string | null
    capacityUnitColor?: string | null
    areaName?: string | null
    typeName?: string | null
    typeIcon?: string | null
    typeColor?: string | null
  }>
  assignments: AssignmentDTO[]
}

/**
 * Resource Assignment Service
 *
 * Provides CRUD operations and state management for resource assignments.
 * Supports draft/confirm workflow for appointments and other modules.
 */
export class ResourceAssignmentService {
  private conflictService: AssignmentConflictService

  constructor(private readonly em: EntityManager) {
    this.conflictService = new AssignmentConflictService(em)
  }

  private normalizeAssignedMemberIds(assignment: ResourcesAssignment): string[] {
    const ids = Array.isArray(assignment.assignedMemberIds)
      ? assignment.assignedMemberIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    if (ids.length > 0) return Array.from(new Set(ids))
    return assignment.assignedMemberId ? [assignment.assignedMemberId] : []
  }

  /**
   * Validate an assignment without creating it
   */
  async validate(params: {
    tenantId: string
    organizationId: string
    resourceId: string
    startsAt: Date
    endsAt: Date
    excludeAssignmentId?: string
    excludeSourceEntityIds?: string[]
    organizationIds?: string[]
    availabilityMode?: AssignmentAvailabilityMode
    availabilityAnchorStartAt?: Date
  }) {
    return this.conflictService.validateAssignment(params)
  }

  /**
   * Get workspace data for assignment management
   * Returns available resources and existing assignments for a source entity
   */
  async getWorkspace(params: {
    tenantId: string
    organizationId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId?: string | null
    resourceIds?: string[]
    organizationIds?: string[]
  }): Promise<AssignmentWorkspace> {
    // Get available resources
    const organizationIds = params.organizationIds?.length ? params.organizationIds : [params.organizationId]
    const resourceWhere: Record<string, unknown> = {
      tenantId: params.tenantId,
      organizationId: { $in: organizationIds },
      isActive: true,
    }

    if (params.resourceIds && params.resourceIds.length > 0) {
      resourceWhere.id = { $in: params.resourceIds }
    }

    const resources = await this.em.find(ResourcesResource, resourceWhere, {
      orderBy: { sortOrder: 'asc', name: 'asc' },
    })

    const areaIds = Array.from(new Set(resources.map((resource) => resource.areaId).filter((id): id is string => Boolean(id))))
    const typeIds = Array.from(new Set(resources.map((resource) => resource.resourceTypeId).filter((id): id is string => Boolean(id))))
    const [areas, types] = await Promise.all([
      areaIds.length > 0
        ? this.em.find(ResourcesResourceArea, { id: { $in: areaIds }, tenantId: params.tenantId, deletedAt: null })
        : [],
      typeIds.length > 0
        ? this.em.find(ResourcesResourceType, { id: { $in: typeIds }, tenantId: params.tenantId, deletedAt: null })
        : [],
    ])
    const areaById = new Map(areas.map((area) => [area.id, area]))
    const typeById = new Map(types.map((type) => [type.id, type]))
    const orderedResources = [...resources].sort((left, right) => {
      const leftArea = left.areaId ? areaById.get(left.areaId) : undefined
      const rightArea = right.areaId ? areaById.get(right.areaId) : undefined
      const leftAreaOrder = leftArea ? leftArea.sortOrder : Number.MAX_SAFE_INTEGER
      const rightAreaOrder = rightArea ? rightArea.sortOrder : Number.MAX_SAFE_INTEGER
      if (leftAreaOrder !== rightAreaOrder) return leftAreaOrder - rightAreaOrder

      const leftAreaName = leftArea?.name ?? ''
      const rightAreaName = rightArea?.name ?? ''
      const areaNameComparison = leftAreaName.localeCompare(rightAreaName)
      if (areaNameComparison !== 0) return areaNameComparison
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
      return left.name.localeCompare(right.name)
    })

    // Get existing assignments for this source entity
    const assignments = params.sourceEntityId
      ? await this.em.find(ResourcesAssignment, {
          tenantId: params.tenantId,
          organizationId: params.organizationId,
          sourceModule: params.sourceModule,
          sourceEntityType: params.sourceEntityType,
          sourceEntityId: params.sourceEntityId,
          cancelledAt: null,
        })
      : []

    return {
      resources: orderedResources.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        appearanceIcon: r.appearanceIcon,
        capacityUnitIcon: r.capacityUnitIcon,
        capacityUnitColor: r.capacityUnitColor,
        areaName: r.areaId ? areaById.get(r.areaId)?.name ?? null : null,
        typeName: r.resourceTypeId ? typeById.get(r.resourceTypeId)?.name ?? null : null,
        typeIcon: r.resourceTypeId ? typeById.get(r.resourceTypeId)?.appearanceIcon ?? null : null,
        typeColor: r.resourceTypeId ? typeById.get(r.resourceTypeId)?.appearanceColor ?? r.appearanceColor : r.appearanceColor,
      })),
      assignments: assignments.map((a) => this.toDTO(a)),
    }
  }

  /**
   * Get assignment by ID
   */
  async getById(params: {
    assignmentId: string
    tenantId: string
    organizationId: string
  }): Promise<AssignmentDTO | null> {
    const assignment = await this.em.findOne(ResourcesAssignment, {
      id: params.assignmentId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
    })
    return assignment ? this.toDTO(assignment) : null
  }

  /**
   * Get all assignments for a source entity
   */
  async getBySource(params: {
    tenantId: string
    organizationId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId: string
    state?: 'draft' | 'confirmed'
  }): Promise<AssignmentDTO[]> {
    const where: Record<string, unknown> = {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: params.sourceModule,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: params.sourceEntityId,
      cancelledAt: null,
    }

    if (params.state) {
      where.state = params.state
    }

    const assignments = await this.em.find(ResourcesAssignment, where, {
      orderBy: { startsAt: 'asc' },
    })

    return assignments.map((a) => this.toDTO(a))
  }

  /**
   * Get assignments for a resource within a date range
   */
  async getByResource(params: {
    tenantId: string
    organizationId: string
    resourceId: string
    startsAt: Date
    endsAt: Date
    includeDraft?: boolean
  }): Promise<AssignmentDTO[]> {
    const where: Record<string, unknown> = {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      resource: params.resourceId,
      startsAt: { $lt: params.endsAt },
      endsAt: { $gt: params.startsAt },
      cancelledAt: null,
    }

    if (!params.includeDraft) {
      where.state = 'confirmed'
    }

    const assignments = await this.em.find(ResourcesAssignment, where, {
      orderBy: { startsAt: 'asc' },
    })

    return assignments.map((a) => this.toDTO(a))
  }

  /**
   * Create or update a draft assignment
   *
   * Business rules:
   * - Creates draft assignment for the specified resource
   * - Validates against blocks, availability, and conflicts
 * - Keeps the confirmed assignment as a baseline until the draft is confirmed
   */
  async upsertDraft(params: AssignmentUpsertParams): Promise<AssignmentDTO> {
    const assignedMemberIds = Array.from(new Set(
      params.assignedMemberIds ?? (params.assignedMemberId ? [params.assignedMemberId] : []),
    ))
    const assignedMemberId = assignedMemberIds[0] ?? null
    // Validate assignment - exclude source entity IDs from conflict check
    // (allows same booking lines to stack on same resource)
    const excludeSourceEntityIds = [
      params.sourceEntityId,  // Always exclude self
      ...(params.excludeSourceEntityIds ?? []),  // Plus caller-provided exclusions
    ]
    const validation = await this.conflictService.validateAssignment({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      resourceId: params.resourceId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      organizationIds: params.organizationIds,
      availabilityMode: params.availabilityMode,
      availabilityAnchorStartAt: params.availabilityAnchorStartAt,
      includeDrafts: params.includeDraftConflicts,
      excludeSourceEntityIds,
    })

    if (!validation.valid) {
      const error = new Error(validation.error?.message ?? 'Validation failed')
      ;(error as Error & { code: string }).code = validation.error?.code ?? 'VALIDATION_ERROR'
      throw error
    }

    // Keep confirmed assignments as the baseline while editing unless the caller
    // explicitly asks to update the currently effective assignment in place.
    let existingAssignment: ResourcesAssignment | null = null
    if (params.preserveState) {
      const activeAssignments = await this.em.find(ResourcesAssignment, {
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        sourceModule: params.sourceModule,
        sourceEntityType: params.sourceEntityType,
        sourceEntityId: params.sourceEntityId,
        state: { $in: ['draft', 'confirmed'] },
        cancelledAt: null,
      }, { orderBy: { updatedAt: 'desc' } })
      existingAssignment = activeAssignments.find((assignment) => assignment.state === 'draft')
        ?? activeAssignments.find((assignment) => assignment.state === 'confirmed')
        ?? null
    } else {
      existingAssignment = await this.em.findOne(ResourcesAssignment, {
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        sourceModule: params.sourceModule,
        sourceEntityType: params.sourceEntityType,
        sourceEntityId: params.sourceEntityId,
        state: 'draft',
        cancelledAt: null,
      })
    }

    let assignment: ResourcesAssignment

    if (existingAssignment) {
      enforceCommandOptimisticLock({
        resourceKind: 'resources.assignment',
        resourceId: existingAssignment.id,
        current: existingAssignment.updatedAt,
        expected: params.expectedUpdatedAt,
      })
      this.em.assign(existingAssignment, {
        resource: params.resourceId,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        assignedMemberId,
        assignedMemberIds,
        title: params.title ?? null,
      })
      assignment = existingAssignment
    } else {
      if (params.expectedUpdatedAt) {
        enforceCommandOptimisticLock({
          resourceKind: 'resources.assignment',
          resourceId: params.sourceEntityId,
          current: null,
          expected: params.expectedUpdatedAt,
        })
      }
      assignment = this.em.create(ResourcesAssignment, {
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        sourceModule: params.sourceModule,
        sourceEntityType: params.sourceEntityType,
        sourceEntityId: params.sourceEntityId,
        resource: params.resourceId,
        state: 'draft',
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        assignedMemberId,
        assignedMemberIds,
        title: params.title ?? null,
        createdByUserId: params.userId ?? null,
      })
    }

    await this.em.flush()
    await this.em.refresh(assignment)

    return this.toDTO(assignment)
  }

  /**
   * Clear (cancel) draft assignment for a source entity
   */
  async clearDraft(params: {
    tenantId: string
    organizationId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId: string
    expectedUpdatedAt?: string
  }): Promise<void> {
    const existing = await this.em.findOne(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: params.sourceModule,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: params.sourceEntityId,
      state: 'draft',
      cancelledAt: null,
    })

    if (existing) {
      enforceCommandOptimisticLock({
        resourceKind: 'resources.assignment',
        resourceId: existing.id,
        current: existing.updatedAt,
        expected: params.expectedUpdatedAt,
      })
      existing.cancelledAt = new Date()
      existing.updatedAt = new Date()
      await this.em.flush()
    } else if (params.expectedUpdatedAt) {
      enforceCommandOptimisticLock({
        resourceKind: 'resources.assignment',
        resourceId: params.sourceEntityId,
        current: null,
        expected: params.expectedUpdatedAt,
      })
    }
  }

  /**
   * Confirm all draft assignments for a source entity
   * Returns the confirmed assignments
   */
  async confirmDrafts(params: {
    tenantId: string
    organizationId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId: string
    userId?: string | null
    expectedUpdatedAt?: string
    organizationIds?: string[]
    excludeSourceEntityIds?: string[]
    includeDraftConflicts?: boolean
    availabilityMode?: AssignmentAvailabilityMode
    availabilityAnchorStartAt?: Date
  }): Promise<AssignmentDTO[]> {
    // Get all drafts for this source
    const drafts = await this.em.find(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: params.sourceModule,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: params.sourceEntityId,
      state: 'draft',
      cancelledAt: null,
    }, { populate: ['resource'] })

    if (drafts.length === 0) {
      if (params.expectedUpdatedAt) {
        enforceCommandOptimisticLock({
          resourceKind: 'resources.assignment',
          resourceId: params.sourceEntityId,
          current: null,
          expected: params.expectedUpdatedAt,
        })
      }
      return []
    }

    enforceCommandOptimisticLock({
      resourceKind: 'resources.assignment',
      resourceId: drafts[0].id,
      current: drafts[0].updatedAt,
      expected: params.expectedUpdatedAt,
    })

    for (const draft of drafts) {
      const resourceId = draft.resource?.id
      if (!resourceId) continue

      const validation = await this.conflictService.validateAssignment({
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        resourceId,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        organizationIds: params.organizationIds,
        availabilityMode: params.availabilityMode,
        availabilityAnchorStartAt: params.availabilityAnchorStartAt,
        includeDrafts: params.includeDraftConflicts,
        excludeAssignmentId: draft.id,
        excludeSourceEntityIds: [
          params.sourceEntityId,
          ...(params.excludeSourceEntityIds ?? []),
        ],
      })

      if (!validation.valid) {
        const error = new Error(validation.error?.message ?? 'Validation failed')
        ;(error as Error & { code: string }).code = validation.error?.code ?? 'VALIDATION_ERROR'
        throw error
      }
    }

    // Find and cancel any existing confirmed assignments
    const confirmed = await this.em.find(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: params.sourceModule,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: params.sourceEntityId,
      state: 'confirmed',
      cancelledAt: null,
    })

    for (const c of confirmed) {
      c.cancelledAt = new Date()
      c.updatedAt = new Date()
    }

    // Convert drafts to confirmed
    for (const draft of drafts) {
      draft.state = 'confirmed'
      draft.updatedAt = new Date()
    }

    await this.em.flush()

    // Refresh all confirmed assignments
    const allAssignments = await this.em.find(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: params.sourceModule,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: params.sourceEntityId,
      cancelledAt: null,
    })

    return allAssignments.map((a) => this.toDTO(a))
  }

  /**
   * Cancel an assignment
   */
  async cancelAssignment(params: {
    assignmentId: string
    tenantId: string
    organizationId: string
  }): Promise<void> {
    const assignment = await this.em.findOne(ResourcesAssignment, {
      id: params.assignmentId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      cancelledAt: null,
    })

    if (assignment) {
      assignment.cancelledAt = new Date()
      assignment.updatedAt = new Date()
      await this.em.flush()
    }
  }

  /**
   * Cancel all active assignments belonging to a set of source entities.
   */
  async cancelAssignmentsForSourceEntities(params: {
    tenantId: string
    organizationId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityIds: string[]
  }): Promise<number> {
    if (params.sourceEntityIds.length === 0) return 0

    const assignments = await this.em.find(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: params.sourceModule,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: { $in: params.sourceEntityIds },
      cancelledAt: null,
    })

    if (assignments.length === 0) return 0

    const cancelledAt = new Date()
    for (const assignment of assignments) {
      assignment.cancelledAt = cancelledAt
      assignment.updatedAt = cancelledAt
    }
    await this.em.flush()
    return assignments.length
  }

  /**
   * Update staff assignment for an existing assignment
   */
  async updateAssignmentStaff(params: {
    assignmentId: string
    tenantId: string
    organizationId: string
    assignedMemberId: string | null
    assignedMemberIds?: string[]
  }): Promise<AssignmentDTO> {
    const assignment = await this.em.findOne(ResourcesAssignment, {
      id: params.assignmentId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      cancelledAt: null,
    })

    if (!assignment) {
      throw new Error('Assignment not found')
    }

    const assignedMemberIds = Array.from(new Set(
      params.assignedMemberIds ?? (params.assignedMemberId ? [params.assignedMemberId] : []),
    ))
    assignment.assignedMemberId = assignedMemberIds[0] ?? null
    assignment.assignedMemberIds = assignedMemberIds
    assignment.updatedAt = new Date()

    await this.em.flush()
    await this.em.refresh(assignment)

    return this.toDTO(assignment)
  }

  /**
   * Convert entity to DTO
   */
  private toDTO(assignment: ResourcesAssignment): AssignmentDTO {
    const assignedMemberIds = this.normalizeAssignedMemberIds(assignment)
    return {
      id: assignment.id,
      resourceId: assignment.resource?.id ?? '',  // ManyToOne - access via relation
      state: assignment.state,
      startsAt: assignment.startsAt.toISOString(),
      endsAt: assignment.endsAt.toISOString(),
      assignedMemberId: assignedMemberIds[0] ?? undefined,
      assignedMemberIds,
      assignedMemberName: undefined, // Will be enriched by caller if needed
      title: assignment.title ?? undefined,
      sourceModule: assignment.sourceModule,
      sourceEntityType: assignment.sourceEntityType,
      sourceEntityId: assignment.sourceEntityId,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
    }
  }
}
