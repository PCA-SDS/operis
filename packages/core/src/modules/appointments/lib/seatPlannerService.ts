/**
 * Appointment Seat Planner Service
 *
 * Wrapper around ResourceAssignmentService for appointment-specific operations.
 * Handles the seat planning workflow for appointments.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { ResourceAssignmentService, type AssignmentDTO } from '@open-mercato/core/modules/resources/lib/resourceAssignmentService'
import { ResourcesAssignment } from '@open-mercato/core/modules/resources/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
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
  allocations: Array<{
    id: string
    appointmentId: string
    lineId: string
    resourceId: string
    resourceName?: string | null
    serviceName: string
    customerName: string
    startsAt: string
    endsAt: string
    state: 'draft' | 'confirmed'
    assignedMemberId?: string | null
    assignedMemberName?: string | null
  }>
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

  private async getResourceOrganizationIds(tenantId: string, organizationId: string): Promise<string[]> {
    const organization = await this.em.findOne(Organization, {
      id: organizationId,
      tenant: tenantId,
      deletedAt: null,
    })
    return Array.from(new Set([organizationId, ...(organization?.ancestorIds ?? [])]))
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
    const plannerLines = lines.map((line) => ({
      line,
      durationMinutes: line.durationMinutes ?? 60,
    }))
    const effectiveEndAt = appointment.requestedEndAt
      ?? new Date(appointment.requestedStartAt.getTime() + plannerLines.reduce((total, entry) => total + entry.durationMinutes, 0) * 60_000)

    const resourceOrganizationIds = await this.getResourceOrganizationIds(params.tenantId, appointment.organizationId)

    // Resources are maintained at the parent organization, while bookings may
    // belong to a child organization. Include the booking org and its ancestors.
    const resources = await this.assignmentService.getWorkspace({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: null,
      organizationIds: resourceOrganizationIds,
    })

    const dayStart = new Date(appointment.requestedStartAt)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const dayAssignments = await this.em.find(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: { $in: resourceOrganizationIds },
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      startsAt: { $lt: dayEnd },
      endsAt: { $gt: dayStart },
      cancelledAt: null,
    }, { orderBy: { startsAt: 'asc' } })

    const assignmentLineIds = Array.from(new Set(dayAssignments.map((assignment) => assignment.sourceEntityId)))
    const allocationLines = assignmentLineIds.length > 0
      ? await this.em.find(AppointmentLine, { id: { $in: assignmentLineIds }, tenantId: params.tenantId, deletedAt: null })
      : []
    const allocationLineById = new Map(allocationLines.map((line) => [line.id, line]))
    const allocationAppointmentIds = Array.from(new Set(allocationLines.map((line) => line.appointment.id)))
    const allocationAppointments = allocationAppointmentIds.length > 0
      ? await this.em.find(Appointment, { id: { $in: allocationAppointmentIds }, tenantId: params.tenantId, deletedAt: null })
      : []
    const allocationAppointmentById = new Map(allocationAppointments.map((entry) => [entry.id, entry]))
    const resourceById = new Map(resources.resources.map((resource) => [resource.id, resource]))
    const allocations = dayAssignments.flatMap((assignment) => {
      const line = allocationLineById.get(assignment.sourceEntityId)
      if (!line) return []
      const sourceAppointment = allocationAppointmentById.get(line.appointment.id)
      const resource = resourceById.get(assignment.resource?.id ?? '')
      return [{
        id: assignment.id,
        appointmentId: sourceAppointment?.id ?? line.appointment.id,
        lineId: line.id,
        resourceId: assignment.resource?.id ?? '',
        resourceName: resource?.name ?? null,
        serviceName: line.productTitle,
        customerName: sourceAppointment?.customerName ?? '',
        startsAt: assignment.startsAt.toISOString(),
        endsAt: assignment.endsAt.toISOString(),
        state: assignment.state,
        assignedMemberId: assignment.assignedMemberId ?? null,
        assignedMemberName: null,
      }]
    }).filter((allocation) => allocation.resourceId.length > 0)

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
          durationMinutes: line.durationMinutes ?? 60,
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
        requestedEndAt: effectiveEndAt.toISOString(),
        statusCode: appointment.statusCode,
      },
      lines: linesWithAssignments,
      allocations,
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

    const resourceOrganizationIds = await this.getResourceOrganizationIds(params.tenantId, line.organizationId)

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
      organizationIds: resourceOrganizationIds,
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
