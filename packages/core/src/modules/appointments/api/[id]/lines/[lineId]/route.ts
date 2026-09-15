import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { Appointment } from '../../../../data/entities'
import { AppointmentSeatPlannerService } from '../../../../lib/seatPlannerService'
import { APPOINTMENT_RESOURCE_KIND } from '../../route'

export type RouteContext = { params: Promise<{ id: string; lineId: string }> }

const uuidSchema = z.string().uuid()

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['appointments.seat_planner.manage'] },
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: appointmentId, lineId } = await ctx.params
    if (!uuidSchema.safeParse(appointmentId).success) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (!uuidSchema.safeParse(lineId).success) {
      return NextResponse.json(
        { error: translate('appointments.lines.notFound', 'Line not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const orgFilter = resolveOrganizationScopeFilter(scope, auth)
    const appointment = await em.findOne(Appointment, {
      id: appointmentId,
      tenantId: auth.tenantId,
      ...orgFilter.where,
      deletedAt: null,
    })
    if (!appointment) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: APPOINTMENT_RESOURCE_KIND,
      resourceId: appointment.id,
      current: appointment.updatedAt ?? null,
      request: req,
    })

    const organizationId = scope.selectedId || auth.orgId || null
    if (!organizationId || !uuidSchema.safeParse(organizationId).success) {
      return NextResponse.json(
        { error: translate('appointments.organization.required', 'Organization scope is required.'), code: 'ORGANIZATION_SCOPE_REQUIRED' },
        { status: 400 },
      )
    }

    const service = new AppointmentSeatPlannerService(em)
    await service.removeLine({ appointmentId, lineId, tenantId: auth.tenantId, organizationId })
    return NextResponse.json({ success: true, updatedAt: appointment.updatedAt.toISOString() })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code
      if (code === 'LINE_NOT_FOUND') {
        return NextResponse.json(
          { error: translate('appointments.lines.notFound', 'Line not found.'), code: 'NOT_FOUND' },
          { status: 404 },
        )
      }
      if (code === 'LAST_LINE') {
        return NextResponse.json(
          { error: translate('appointments.seatPlanner.cannotRemoveLastService', 'A booking must contain at least one service.'), code },
          { status: 409 },
        )
      }
    }
    return NextResponse.json(
      { error: translate('appointments.seatPlanner.removeServiceFailed', 'Unable to remove service.'), code: 'DELETE_FAILED' },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Remove a service from an appointment',
  methods: {
    DELETE: {
      summary: 'Remove an appointment line and its resource assignments',
      responses: [
        { status: 200, description: 'Appointment line removed' },
        { status: 404, description: 'Appointment or line not found' },
        { status: 409, description: 'The appointment must retain one service' },
      ],
    },
  },
}
