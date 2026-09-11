/**
 * Appointment Seat Planner Service
 *
 * Wrapper around ResourceAssignmentService for appointment-specific operations.
 * Handles the seat planning workflow for appointments.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { ResourceAssignmentService, type AssignmentDTO } from '@open-mercato/core/modules/resources/lib/resourceAssignmentService'
import { Appointment, AppointmentLine } from '../data/entities'

export interface SeatPlannerLine {
  id: string
  productTitle: string
  durationMinutes: number | null
  currentAssignment?: {
    id: string
    state: 'draft' | 'confirmed'
    resourceId: string
    resourceName?: string | null
    startsAt: string
    endsAt: string
    assignedMemberId?: string | null
    assignedMemberName?: string | null
  }
}

export interface SeatPlannerWorkspace {
  appointment: {
    id: string
    customerName: string
    requestedStartAt: string
    requestedEndAt: string | null
    statusCode: string
  }
  lines: SeatPlannerLine[]
  resources: Array<{
    id: string
    name: string
    code?: string | null
    areaName?: string | null
    typeName?: string | null
    typeColor?: string | null
  }>
}

export interface UpsertDraftParams {
  lineId: string
  resourceId: string
  startsAt: Date
  endsAt: Date
  assignedMemberId?: string | null
}

export interface UpdateStaffParams {
  assignmentId: string
  assignedMemberId: string | null
}

/**
 * Appointment Seat Planner Service
 *
 * Provides seat planning functionality for appointments.
 * Wraps the generic ResourceAssignmentService with appointment-specific logic.
 */
export class AppointmentSeatPlannerService {
  private assignmentService: ResourceAssignmentService

  constructor(private readonly em: EntityManager) {
    this.assignmentService = new ResourceAssignmentService(em)
  }

  /**
   * Get seat planner workspace for an appointment
   */
  async getWorkspace(params: {
    appointmentId: string
    tenantId: string
    organizationId: string
  }): Promise<SeatPlannerWorkspace> {
    // Load appointment
    const appointment = await this.em.findOne(Appointment, {
      id: params.appointmentId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      deletedAt: null,
    })

    if (!appointment) {
      throw new Error('Appointment not found')
    }

    // Load lines
    const lines = await this.em.find(
      AppointmentLine,
      {
        appointment: params.appointmentId,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'asc' } },
    )

    // Load resources (seats available for this org)
    const resources = await this.assignmentService.getWorkspace({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: null,
    })

    // Load assignments for each line
    const linesWithAssignments: SeatPlannerLine[] = await Promise.all(
      lines.map(async (line) => {
        const assignments = await this.assignmentService.getBySource({
          tenantId: params.tenantId,
          organizationId: params.organizationId,
          sourceModule: 'appointment',
          sourceEntityType: 'appointment_line',
          sourceEntityId: line.id,
        })

        // Find confirmed or draft assignment
        const assignment = assignments.find(
          (a) => a.state === 'confirmed' || a.state === 'draft',
        )

        // Find resource name
        const resource = assignment
          ? resources.resources.find((r) => r.id === assignment.resourceId)
          : undefined

        return {
          id: line.id,
          productTitle: line.productTitle,
          durationMinutes: line.durationMinutes ?? null,
          currentAssignment: assignment
            ? {
                id: assignment.id,
                state: assignment.state,
                resourceId: assignment.resourceId,
                resourceName: resource?.name,
                startsAt: assignment.startsAt,
                endsAt: assignment.endsAt,
                assignedMemberId: assignment.assignedMemberId,
                assignedMemberName: assignment.assignedMemberName,
              }
            : undefined,
        }
      }),
    )

    return {
      appointment: {
        id: appointment.id,
        customerName: appointment.customerName,
        requestedStartAt: appointment.requestedStartAt.toISOString(),
        requestedEndAt: appointment.requestedEndAt?.toISOString() ?? null,
        statusCode: appointment.statusCode,
      },
      lines: linesWithAssignments,
      resources: resources.resources,
    }
  }

  /**
   * Upsert draft assignment for an appointment line
   */
  async upsertDraft(params: {
    appointmentId: string
    tenantId: string
    organizationId: string
    userId?: string | null
  } & UpsertDraftParams): Promise<AssignmentDTO> {
    // Validate line belongs to appointment
    const line = await this.em.findOne(AppointmentLine, {
      id: params.lineId,
      appointment: params.appointmentId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      deletedAt: null,
    })

    if (!line) {
      const error = new Error('Line not found')
      ;(error as Error & { code: string }).code = 'LINE_NOT_FOUND'
      throw error
    }

    // Use the assignment service
    return this.assignmentService.upsertDraft({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: params.lineId,
      resourceId: params.resourceId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      assignedMemberId: params.assignedMemberId,
      title: line.productTitle ?? undefined,
      userId: params.userId,
    })
  }

  /**
   * Clear draft assignment for an appointment line
   */
  async clearDraft(params: {
    appointmentId: string
    lineId: string
    tenantId: string
    organizationId: string
  }): Promise<void> {
    // Validate line belongs to appointment
    const line = await this.em.findOne(AppointmentLine, {
      id: params.lineId,
      appointment: params.appointmentId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      deletedAt: null,
    })

    if (!line) {
      const error = new Error('Line not found')
      ;(error as Error & { code: string }).code = 'LINE_NOT_FOUND'
      throw error
    }

    await this.assignmentService.clearDraft({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: params.lineId,
    })
  }

  /**
   * Confirm all draft assignments for an appointment
   */
  async confirmDrafts(params: {
    appointmentId: string
    tenantId: string
    organizationId: string
    userId?: string | null
  }): Promise<AssignmentDTO[]> {
    // Load lines to get all sourceEntityIds
    const lines = await this.em.find(
      AppointmentLine,
      {
        appointment: params.appointmentId,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        deletedAt: null,
      },
    )

    const allAssignments: AssignmentDTO[] = []

    // Confirm drafts for each line
    for (const line of lines) {
      const assignments = await this.assignmentService.confirmDrafts({
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        sourceModule: 'appointment',
        sourceEntityType: 'appointment_line',
        sourceEntityId: line.id,
        userId: params.userId,
      })
      allAssignments.push(...assignments)
    }

    return allAssignments
  }

  /**
   * Update staff assignment for an existing assignment
   */
  async updateStaff(params: {
    appointmentId: string
  } & UpdateStaffParams): Promise<AssignmentDTO> {
    return this.assignmentService.updateAssignmentStaff({
      assignmentId: params.assignmentId,
      assignedMemberId: params.assignedMemberId,
    })
  }
}
