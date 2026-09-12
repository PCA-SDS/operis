/**
 * Appointment Seat Planner Service
 *
 * Wrapper around ResourceAssignmentService for appointment-specific operations.
 * Handles the seat planning workflow for appointments.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { ResourceAssignmentService, type AssignmentDTO } from '@open-mercato/core/modules/resources/lib/resourceAssignmentService'
import { ResourcesAssignment, ResourcesResource } from '@open-mercato/core/modules/resources/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CatalogProductOption, CatalogProductOptionGroup } from '@open-mercato/core/modules/catalog/data/entities'
import { PlannerAvailabilityRule } from '@open-mercato/core/modules/planner/data/entities'
import { getMergedAvailabilityWindows } from '@open-mercato/core/modules/planner/lib/availabilityMerge'
import { Appointment, AppointmentLine, AppointmentLineOptionGroup } from '../data/entities'
import { loadLineOptionSnapshots, resolveDurationMinutes } from './lineOptionSnapshot'

export interface SeatPlannerLine {
  id: string
  productId: string
  productTitle: string
  durationMinutes: number | null
  options: Array<{ groupName: string | null; name: string }>
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
    tenantId: string
    organizationId: string
    customerName: string
    customerSalutation: string | null
    customerPhone: string | null
    customerEmail: string | null
    customerOrigin: string | null
    bookingType: string | null
    organizationName: string | null
    requestedStartAt: string
    requestedEndAt: string | null
    statusCode: string
    updatedAt: string
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
    availabilityWindows: Array<{ startsAt: string; endsAt: string }> | null
  }>
}

function normalizeLineOptions(
  value: Record<string, unknown> | Record<string, unknown>[] | null | undefined,
  groupNames: Map<string, string>,
  optionNames: Map<string, { groupName: string | null; name: string }>,
): Array<{ groupName: string | null; name: string }> {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).flatMap(([groupId, selected]) => {
          const selectedValues = Array.isArray(selected) ? selected : [selected]
          return selectedValues.map((optionId) => ({
            groupName: groupNames.get(groupId) ?? null,
            name: typeof optionId === 'string' ? optionNames.get(optionId)?.name ?? optionId : '',
          }))
        })
      : []
  return values.flatMap((option) => {
    if (option.name && typeof option.name === 'string') {
      return [{
        groupName: typeof option.groupName === 'string' ? option.groupName : null,
        name: option.name,
      }]
    }
    const record = option as Record<string, unknown>
    const name = typeof record.label === 'string'
      ? record.label
      : typeof record.value === 'string'
        ? record.value
          : null
    if (!name) return []
    return [{
      groupName: typeof record.groupName === 'string' ? record.groupName : null,
      name,
    }]
  })
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

    const appointmentOrganization = await this.em.findOne(Organization, {
      id: appointment.organizationId,
      tenant: params.tenantId,
      deletedAt: null,
    })

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

    const scheduleDayStart = new Date(appointment.requestedStartAt)
    scheduleDayStart.setHours(0, 0, 0, 0)
    const scheduleDayEnd = new Date(scheduleDayStart)
    scheduleDayEnd.setDate(scheduleDayEnd.getDate() + 1)
    const resourceRecords = resources.resources.length > 0
      ? await this.em.find(ResourcesResource, {
          id: { $in: resources.resources.map((resource) => resource.id) },
          tenantId: params.tenantId,
          organizationId: { $in: resourceOrganizationIds },
          deletedAt: null,
        })
      : []
    const resourceRecordById = new Map(resourceRecords.map((resource) => [resource.id, resource]))
    const resourceIds = resources.resources.map((resource) => resource.id)
    const resourceRuleSetIds = resourceRecords
      .map((resource) => resource.availabilityRuleSetId)
      .filter((ruleSetId): ruleSetId is string => Boolean(ruleSetId))
    const [resourceAvailabilityRules, ruleSetAvailabilityRules] = resourceIds.length > 0
      ? await Promise.all([
          this.em.find(PlannerAvailabilityRule, {
            tenantId: params.tenantId,
            organizationId: { $in: resourceOrganizationIds },
            subjectType: 'resource',
            subjectId: { $in: resourceIds },
            deletedAt: null,
          }),
          resourceRuleSetIds.length > 0
            ? this.em.find(PlannerAvailabilityRule, {
                tenantId: params.tenantId,
                organizationId: { $in: resourceOrganizationIds },
                subjectType: 'ruleset',
                subjectId: { $in: resourceRuleSetIds },
                deletedAt: null,
              })
            : Promise.resolve([]),
        ])
      : [[], []]
    const availabilityRulesByResource = new Map<string, PlannerAvailabilityRule[]>()
    const rulesBySubjectId = new Map<string, PlannerAvailabilityRule[]>()
    for (const rule of [...resourceAvailabilityRules, ...ruleSetAvailabilityRules]) {
      rulesBySubjectId.set(rule.subjectId, [...(rulesBySubjectId.get(rule.subjectId) ?? []), rule])
    }
    for (const resource of resourceRecords) {
      const rules = [
        ...(rulesBySubjectId.get(resource.id) ?? []),
        ...(resource.availabilityRuleSetId ? rulesBySubjectId.get(resource.availabilityRuleSetId) ?? [] : []),
      ]
      if (rules.length > 0) {
        availabilityRulesByResource.set(resource.id, rules)
      }
    }
    const resourcesWithAvailability = resources.resources.map((resource) => {
      const resourceRecord = resourceRecordById.get(resource.id)
      const rules = availabilityRulesByResource.get(resource.id) ?? []
      const availabilityWindows = resourceRecord?.availabilityRuleSetId && rules.length > 0
        ? getMergedAvailabilityWindows({
            rules: rules.map((rule) => ({
              id: rule.id,
              rrule: rule.rrule,
              exdates: rule.exdates,
              kind: rule.kind,
            })),
            range: { start: scheduleDayStart, end: scheduleDayEnd },
          }).map((window) => ({ startsAt: window.start.toISOString(), endsAt: window.end.toISOString() }))
        : null
      return { ...resource, availabilityWindows }
    })

    // Load option snapshots for all lines (prefer snapshot tables, fallback to catalog)
    const productIds = lines.map((line) => line.productId)

    // Build catalog lookup maps as fallback for legacy data
    const catalogGroups = productIds.length > 0
      ? await this.em.find(CatalogProductOptionGroup, {
          tenantId: params.tenantId,
          organizationId: { $in: resourceOrganizationIds },
          product: { $in: productIds },
          isActive: true,
          deletedAt: null,
        })
      : []
    const catalogGroupIds = catalogGroups.map((group) => group.id)
    const catalogOptions = catalogGroupIds.length > 0
      ? await this.em.find(CatalogProductOption, {
          tenantId: params.tenantId,
          organizationId: { $in: resourceOrganizationIds },
          group: { $in: catalogGroupIds },
          isActive: true,
          deletedAt: null,
        })
      : []
    const catalogGroupNames = new Map(catalogGroups.map((group) => [group.id, group.name]))
    const catalogOptionNames = new Map(catalogOptions.map((option) => [option.id, {
      groupName: typeof option.group === 'string' ? catalogGroupNames.get(option.group) ?? null : option.group.name,
      name: option.name,
    }]))

    // Load allocations for the day (other bookings on the calendar)
    const dayAssignments = await this.em.find(ResourcesAssignment, {
      tenantId: params.tenantId,
      organizationId: { $in: resourceOrganizationIds },
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      startsAt: { $lt: scheduleDayEnd },
      endsAt: { $gt: scheduleDayStart },
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
    const resourceById = new Map(resourcesWithAvailability.map((resource) => [resource.id, resource]))
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

        // Drafts overlay the confirmed baseline while the booking is being edited.
        const assignment = assignments.find((a) => a.state === 'draft')
          ?? assignments.find((a) => a.state === 'confirmed')

        // Find resource name
        const resource = assignment
          ? resourcesWithAvailability.find((r) => r.id === assignment.resourceId)
          : undefined

        // Try to load options from snapshot tables first, fallback to catalog lookup
        let options: Array<{ groupName: string | null; name: string }>
        let resolvedDuration = line.durationMinutes
        try {
          const snapshots = await loadLineOptionSnapshots(this.em, line.id)
          resolvedDuration = resolveDurationMinutes(line.durationMinutes, snapshots.groups.flatMap((group) => group.options))
          if (snapshots.groups.length > 0) {
            // Use snapshot data
            options = snapshots.groups.flatMap((g) =>
              g.options.map((o) => ({
                groupName: g.breadcrumbPath ?? g.groupName,
                name: o.optionName,
              })),
            )
          } else {
            // Fallback to catalog lookup for legacy data
            options = normalizeLineOptions(line.selectedOptions, catalogGroupNames, catalogOptionNames)
          }
        } catch {
          // Fallback to catalog lookup
          options = normalizeLineOptions(line.selectedOptions, catalogGroupNames, catalogOptionNames)
        }

        return {
          id: line.id,
          productId: line.productId,
          productTitle: line.productTitle,
          durationMinutes: resolvedDuration ?? 60,
          options,
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
    const effectiveEndAt = new Date(
      appointment.requestedStartAt.getTime()
        + linesWithAssignments.reduce((total, line) => total + (line.durationMinutes ?? 60), 0) * 60_000,
    )

    return {
      appointment: {
        id: appointment.id,
        tenantId: appointment.tenantId,
        organizationId: appointment.organizationId,
        customerName: appointment.customerName,
        customerSalutation: appointment.customerSalutation ?? null,
        customerPhone: appointment.customerPhone
          ? [appointment.customerPhoneCountryCode, appointment.customerPhone].filter(Boolean).join(' ')
          : null,
        customerEmail: appointment.customerEmail ?? null,
        customerOrigin: appointment.customerOrigin ?? null,
        bookingType: appointment.bookingType ?? null,
        organizationName: appointmentOrganization?.name ?? null,
        requestedStartAt: appointment.requestedStartAt.toISOString(),
        requestedEndAt: effectiveEndAt.toISOString(),
        statusCode: appointment.statusCode,
        updatedAt: appointment.updatedAt.toISOString(),
      },
      lines: linesWithAssignments,
      allocations,
      resources: resourcesWithAvailability,
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

    // Get all line IDs for this appointment to exclude from conflict checking
    // (same booking lines CAN stack on the same resource)
    const appointmentLines = await this.em.find(AppointmentLine, {
      appointment: params.appointmentId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      deletedAt: null,
    })
    const excludeSourceEntityIds = appointmentLines.map((l) => l.id)

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
      excludeSourceEntityIds,
      includeDraftConflicts: true,
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
