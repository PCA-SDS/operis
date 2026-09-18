import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { StaffTeamMember } from '@open-mercato/core/modules/staff/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ResourcesAssignment, ResourcesResource } from '@open-mercato/core/modules/resources/data/entities'
import { Appointment, AppointmentLine } from '../../data/entities'
import { deriveScheduleConfirmationStatus } from '../../lib/scheduleTracking'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

function toDayBounds(date: string) {
  return {
    start: new Date(`${date}T00:00:00.000Z`),
    end: new Date(`${date}T23:59:59.999Z`),
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = new URL(req.url)
    const date = dateSchema.parse(url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10))
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const scope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: req,
      selectedId: url.searchParams.get('organizationId') ?? undefined,
    })
    const organizationId = scope.selectedId ?? auth.orgId ?? null
    if (!organizationId) return NextResponse.json({ error: 'Organization scope is required', code: 'ORGANIZATION_SCOPE_REQUIRED' }, { status: 400 })
    const { start, end } = toDayBounds(date)

    const [organization, resources, appointments, allAppointments] = await Promise.all([
      em.findOne(Organization, { id: organizationId, tenant: auth.tenantId, deletedAt: null }),
      em.find(ResourcesResource, { tenantId: auth.tenantId, organizationId, deletedAt: null, isActive: true }, { orderBy: { sortOrder: 'asc', name: 'asc' } }),
      em.find(Appointment, {
        tenantId: auth.tenantId,
        organizationId,
        deletedAt: null,
        requestedStartAt: { $gte: start, $lte: end },
      }, { orderBy: { requestedStartAt: 'asc' } }),
      em.find(Appointment, {
        tenantId: auth.tenantId,
        organizationId,
        deletedAt: null,
      }, { orderBy: { createdAt: 'desc' } }),
    ])
    const appointmentIds = appointments.map((appointment) => appointment.id)
    const lines = appointmentIds.length > 0
      ? await em.find(AppointmentLine, { appointment: { $in: appointmentIds }, tenantId: auth.tenantId, deletedAt: null }, { orderBy: { sortOrder: 'asc' } })
      : []
    const linesByAppointment = new Map<string, AppointmentLine[]>()
    for (const line of lines) {
      const appointmentId = String(line.appointment.id)
      linesByAppointment.set(appointmentId, [...(linesByAppointment.get(appointmentId) ?? []), line])
    }
    const allAppointmentIds = allAppointments.map((appointment) => appointment.id)
    const allLines = allAppointmentIds.length > 0
      ? await em.find(AppointmentLine, { appointment: { $in: allAppointmentIds }, tenantId: auth.tenantId, deletedAt: null }, { orderBy: { sortOrder: 'asc' } })
      : []
    const allLinesByAppointment = new Map<string, AppointmentLine[]>()
    for (const line of allLines) {
      const appointmentId = String(line.appointment.id)
      allLinesByAppointment.set(appointmentId, [...(allLinesByAppointment.get(appointmentId) ?? []), line])
    }
    const assignments = await em.find(ResourcesAssignment, {
      tenantId: auth.tenantId,
      organizationId,
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      state: { $in: ['draft', 'confirmed'] },
      cancelledAt: null,
      startsAt: { $lt: end },
      endsAt: { $gt: start },
    }, { populate: ['resource'] })
    const confirmedAssignments = allLines.length > 0
      ? await em.find(ResourcesAssignment, {
        tenantId: auth.tenantId,
        organizationId,
        sourceModule: 'appointment',
        sourceEntityType: 'appointment_line',
        sourceEntityId: { $in: allLines.map((line) => line.id) },
        state: 'confirmed',
        cancelledAt: null,
      })
      : []
    const assignmentLineIds = Array.from(new Set(assignments.map((assignment) => assignment.sourceEntityId)))
    const assignmentLines = assignmentLineIds.length > 0
      ? await em.find(AppointmentLine, { id: { $in: assignmentLineIds }, tenantId: auth.tenantId, deletedAt: null })
      : []
    const assignmentLineById = new Map(assignmentLines.map((line) => [line.id, line]))
    const appointmentById = new Map(appointments.map((appointment) => [appointment.id, appointment]))
    const memberIds = Array.from(new Set(assignments.map((assignment) => assignment.assignedMemberId).filter((id): id is string => Boolean(id))))
    const members = memberIds.length > 0
      ? await findWithDecryption(em, StaffTeamMember, { id: { $in: memberIds }, tenantId: auth.tenantId, deletedAt: null })
      : []
    const memberNames = new Map(members.map((member) => [member.id, member.displayName]))

    const blocks = assignments.flatMap((assignment) => {
      const line = assignmentLineById.get(assignment.sourceEntityId)
      const appointment = line ? appointmentById.get(String(line.appointment.id)) : undefined
      if (!line || !appointment) return []
      return [{
        id: assignment.id,
        appointmentId: appointment.id,
        lineId: line.id,
        resourceId: assignment.resource?.id ?? null,
        resourceName: assignment.resource?.name ?? null,
        assignedMemberId: assignment.assignedMemberId ?? null,
        assignedMemberName: assignment.assignedMemberId ? memberNames.get(assignment.assignedMemberId) ?? null : null,
        startsAt: assignment.startsAt.toISOString(),
        endsAt: assignment.endsAt.toISOString(),
        state: assignment.state,
        serviceName: line.productTitle,
        serviceCategory: line.productCategory ?? null,
      }]
    })
    const assignedLineIds = new Set(assignments.map((assignment) => assignment.sourceEntityId))
    const unassigned = appointments.filter((appointment) => (linesByAppointment.get(appointment.id) ?? []).some((line) => !assignedLineIds.has(line.id)))
    const confirmedAllocationCountByAppointment = new Map<string, number>()
    const lineAppointmentById = new Map(allLines.map((line) => [line.id, String(line.appointment.id)]))
    for (const assignment of confirmedAssignments) {
      const appointmentId = lineAppointmentById.get(assignment.sourceEntityId)
      if (!appointmentId) continue
      confirmedAllocationCountByAppointment.set(
        appointmentId,
        (confirmedAllocationCountByAppointment.get(appointmentId) ?? 0) + 1,
      )
    }
    const unconfirmedAppointmentIds = allAppointments
      .filter((appointment) => deriveScheduleConfirmationStatus({
        createdAt: appointment.createdAt,
        confirmedAllocationCount: confirmedAllocationCountByAppointment.get(appointment.id) ?? 0,
        statusCode: appointment.statusCode,
      }) === 'unconfirmed')
      .map((appointment) => appointment.id)

    const unconfirmedAppointments = allAppointments
      .filter((appointment) => unconfirmedAppointmentIds.includes(appointment.id))
      .map((appointment) => ({
        id: appointment.id,
        organizationId: appointment.organizationId,
        customerName: appointment.customerName,
        customerSalutation: appointment.customerSalutation ?? null,
        customerPhoneCountryCode: appointment.customerPhoneCountryCode ?? null,
        customerPhone: appointment.customerPhone ?? null,
        bookingType: appointment.bookingType ?? null,
        statusCode: appointment.statusCode,
        requestedStartAt: appointment.requestedStartAt.toISOString(),
        requestedEndAt: appointment.requestedEndAt?.toISOString() ?? null,
        lines: (allLinesByAppointment.get(appointment.id) ?? []).map((line) => ({ id: line.id, productId: line.productId, productTitle: line.productTitle, productCategory: line.productCategory ?? null, durationMinutes: line.durationMinutes ?? null })),
      }))

    return NextResponse.json({
      date,
      organization: { id: organizationId, name: organization?.name ?? organizationId },
      resources: resources.map((resource) => ({ id: resource.id, name: resource.name, appearanceIcon: resource.appearanceIcon ?? null, appearanceColor: resource.appearanceColor ?? null, areaId: resource.areaId ?? null })),
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        organizationId: appointment.organizationId,
        customerName: appointment.customerName,
        customerSalutation: appointment.customerSalutation ?? null,
        bookingType: appointment.bookingType ?? null,
        statusCode: appointment.statusCode,
        requestedStartAt: appointment.requestedStartAt.toISOString(),
        requestedEndAt: appointment.requestedEndAt?.toISOString() ?? null,
        lines: (linesByAppointment.get(appointment.id) ?? []).map((line) => ({ id: line.id, productId: line.productId, productTitle: line.productTitle, productCategory: line.productCategory ?? null, durationMinutes: line.durationMinutes ?? null })),
      })),
      blocks,
      unassignedAppointmentIds: unassigned.map((appointment) => appointment.id),
      unconfirmedAppointmentIds,
      unconfirmedAppointments,
    })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: translate('appointments.overview.invalidDate', 'Invalid overview date.'), code: 'INVALID_DATE' }, { status: 400 })
    return NextResponse.json({ error: translate('appointments.overview.failed', 'Unable to load booking overview.'), code: 'OVERVIEW_FAILED' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Load the daily appointment booking overview',
  methods: { GET: { summary: 'Load daily booking overview', responses: [{ status: 200, description: 'Daily booking overview' }] } },
}
