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
import { ResourcesAssignment, ResourcesResource } from '../data/entities'
import { AssignmentConflictService } from './assignmentConflict'

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
  title?: string

  // Audit
  userId?: string | null
}

export interface AssignmentDTO {
  id: string
  resourceId: string
  resourceName?: string | null
  state: 'draft' | 'confirmed'
  startsAt: string
  endsAt: string
  assignedMemberId?: string | null
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
    areaName?: string | null
    typeName?: string | null
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
  }): Promise<AssignmentWorkspace> {
    // Get available resources
    const resourceWhere: Record<string, unknown> = {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      isActive: true,
    }

    if (params.resourceIds && params.resourceIds.length > 0) {
      resourceWhere.id = { $in: params.resourceIds }
    }

    const resources = await this.em.find(ResourcesResource, resourceWhere, {
      orderBy: { sortOrder: 'asc', name: 'asc' },
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
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.capacityUnitValue,
        areaName: null, // Will be enriched if needed
        typeName: null,
        typeColor: r.appearanceColor,
      })),
      assignments: assignments.map((a) => this.toDTO(a)),
    }
  }

  /**
   * Get assignment by ID
   */
  async getById(assignmentId: string): Promise<AssignmentDTO | null> {
    const assignment = await this.em.findOne(ResourcesAssignment, { id: assignmentId })
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
   * - Automatically cancels old confirmed assignment for the same source entity
   */
  async upsertDraft(params: AssignmentUpsertParams): Promise<AssignmentDTO> {
    // Validate assignment
    const validation = await this.conflictService.validateAssignment({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      resourceId: params.resourceId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      excludeSourceEntityIds: [params.sourceEntityId], // Allow chaining with self
    })

    if (!validation.valid) {
      const error = new Error(validation.error?.message ?? 'Validation failed')
      ;(error as Error & { code: string }).code = validation.error?.code ?? 'VALIDATION_ERROR'
      throw error
    }

    // Check for existing assignment for this source entity
    const existing = await this.em.findOne(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: params.sourceModule,
      sourceEntityType: params.sourceEntityType,
      sourceEntityId: params.sourceEntityId,
      cancelledAt: null,
    })

    let assignment: ResourcesAssignment

    if (existing) {
      // If there's a confirmed assignment, cancel it first
      if (existing.state === 'confirmed') {
        existing.cancelledAt = new Date()
        existing.updatedAt = new Date()
        this.em.persist(existing)
      }

      // Update existing draft or create new if old one was confirmed
      if (existing.state === 'draft') {
        // Use assign() to update ManyToOne relation with raw ID
        this.em.assign(existing, {
          resource: params.resourceId,
          startsAt: params.startsAt,
          endsAt: params.endsAt,
          assignedMemberId: params.assignedMemberId ?? null,
          title: params.title ?? null,
        })
        assignment = existing
      } else {
        // Create new assignment after cancelling old confirmed
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
          assignedMemberId: params.assignedMemberId ?? null,
          title: params.title ?? null,
          createdByUserId: params.userId ?? null,
        })
      }
    } else {
      // Create new draft assignment
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
        assignedMemberId: params.assignedMemberId ?? null,
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
      existing.cancelledAt = new Date()
      existing.updatedAt = new Date()
      await this.em.flush()
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
    })

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
  }): Promise<void> {
    const assignment = await this.em.findOne(ResourcesAssignment, {
      id: params.assignmentId,
      cancelledAt: null,
    })

    if (assignment) {
      assignment.cancelledAt = new Date()
      assignment.updatedAt = new Date()
      await this.em.flush()
    }
  }

  /**
   * Update staff assignment for an existing assignment
   */
  async updateAssignmentStaff(params: {
    assignmentId: string
    assignedMemberId: string | null
  }): Promise<AssignmentDTO> {
    const assignment = await this.em.findOne(ResourcesAssignment, {
      id: params.assignmentId,
      cancelledAt: null,
    })

    if (!assignment) {
      throw new Error('Assignment not found')
    }

    assignment.assignedMemberId = params.assignedMemberId
    assignment.updatedAt = new Date()

    await this.em.flush()
    await this.em.refresh(assignment)

    return this.toDTO(assignment)
  }

  /**
   * Convert entity to DTO
   */
  private toDTO(assignment: ResourcesAssignment): AssignmentDTO {
    return {
      id: assignment.id,
      resourceId: assignment.resource?.id ?? '',  // ManyToOne - access via relation
      state: assignment.state,
      startsAt: assignment.startsAt.toISOString(),
      endsAt: assignment.endsAt.toISOString(),
      assignedMemberId: assignment.assignedMemberId ?? undefined,
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
