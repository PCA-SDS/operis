import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { Appointment } from '../../../data/entities'
import { appointmentLineAddSchema } from '../../../data/validators'
import { addServiceToAppointment } from '../../../lib/intake'
import { APPOINTMENT_RESOURCE_KIND } from '../route'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'

export type RouteContext = { params: Promise<{ id: string }> }

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['appointments.seat_planner.manage'] },
}

export async function POST(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await ctx.params
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    const body = appointmentLineAddSchema.parse(await readJsonSafe(req, {}))
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const pricingService = container.resolve<CatalogPricingService>('catalogPricingService')
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const orgFilter = resolveOrganizationScopeFilter(scope, auth)
    const appointment = await em.findOne(Appointment, {
      id,
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
    const line = await addServiceToAppointment(
      em,
      {
        appointmentId: appointment.id,
        tenantId: auth.tenantId,
        organizationId: appointment.organizationId,
        productId: body.productId,
        selectedOptions: body.selectedOptions,
      },
      { pricingService },
    )
    return NextResponse.json({
      line: {
        id: line.id,
        productId: line.productId,
        productTitle: line.productTitle,
        durationMinutes: line.durationMinutes ?? null,
        sortOrder: line.sortOrder,
      },
      updatedAt: appointment.updatedAt.toISOString(),
    }, { status: 201 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      if (error.body.code === 'SERVICE_ALREADY_ADDED') {
        return NextResponse.json(
          { error: translate('appointments.seatPlanner.serviceAlreadyAdded', 'This service is already added to the appointment.'), code: error.body.code },
          { status: error.status },
        )
      }
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: translate('appointments.create.invalidInput', 'Invalid appointment payload.'), code: 'INVALID_INPUT' }, { status: 400 })
    }
    return NextResponse.json({ error: translate('appointments.update.failed', 'Unable to update appointment.'), code: 'UPDATE_FAILED' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Add a service to an appointment',
  methods: {
    POST: {
      summary: 'Add one appointment line',
      requestBody: { contentType: 'application/json', schema: appointmentLineAddSchema },
      responses: [
        { status: 201, description: 'Appointment line added' },
        { status: 400, description: 'Invalid request' },
        { status: 404, description: 'Appointment not found' },
      ],
    },
  },
}
