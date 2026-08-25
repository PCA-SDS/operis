import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Appointment, AppointmentLine, AppointmentStatus } from '../../data/entities'
import { appointmentStatusUpdateSchema } from '../../data/validators'
import { emitAppointmentEvent } from '../../events'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['appointments.manage'] },
}

type RouteContext = { params: Promise<{ id: string }> }

function mapLine(line: AppointmentLine) {
  return {
    id: line.id,
    productId: line.productId,
    productTitle: line.productTitle,
    productHandle: line.productHandle ?? null,
    currencyCode: line.currencyCode ?? null,
    unitPriceNet: line.unitPriceNet ?? null,
    unitPriceGross: line.unitPriceGross ?? null,
    durationMinutes: line.durationMinutes ?? null,
    sortOrder: line.sortOrder,
  }
}

function mapAppointment(row: Appointment, lines: AppointmentLine[]) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    customerEntityId: row.customerEntityId,
    customerName: row.customerName,
    customerSalutation: row.customerSalutation ?? null,
    customerPhone: row.customerPhone ?? null,
    customerEmail: row.customerEmail ?? null,
    statusCode: row.statusCode,
    requestedStartAt: row.requestedStartAt.toISOString(),
    requestedEndAt: row.requestedEndAt?.toISOString() ?? null,
    notes: row.notes ?? null,
    lines: lines.map(mapLine),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function loadScopedAppointment(
  em: EntityManager,
  tenantId: string,
  id: string,
): Promise<Appointment | null> {
  return em.findOne(Appointment, {
    id,
    tenantId,
    deletedAt: null,
  })
}

export async function GET(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await ctx.params
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const appointment = await loadScopedAppointment(em, auth.tenantId, id)
    if (!appointment) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    const lines = await em.find(
      AppointmentLine,
      { appointment: appointment.id, deletedAt: null },
      { orderBy: { sortOrder: 'asc' } },
    )
    return NextResponse.json(mapAppointment(appointment, lines))
  } catch {
    return NextResponse.json(
      { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
      { status: 404 },
    )
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await ctx.params
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    const body = appointmentStatusUpdateSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const appointment = await loadScopedAppointment(em, auth.tenantId, id)
    if (!appointment) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    const status = await em.findOne(AppointmentStatus, {
      tenantId: auth.tenantId,
      code: body.statusCode,
      deletedAt: null,
    })
    if (!status) {
      return NextResponse.json(
        {
          error: translate('appointments.status.invalid', 'Invalid appointment status.'),
          code: 'INVALID_STATUS',
        },
        { status: 400 },
      )
    }
    appointment.status = status
    appointment.statusCode = status.code
    await em.flush()
    try {
      await emitAppointmentEvent('appointments.appointment.updated', {
        id: appointment.id,
        tenantId: appointment.tenantId,
        organizationId: appointment.organizationId,
        statusCode: appointment.statusCode,
      })
    } catch {
      /* best-effort */
    }
    const lines = await em.find(
      AppointmentLine,
      { appointment: appointment.id, deletedAt: null },
      { orderBy: { sortOrder: 'asc' } },
    )
    return NextResponse.json(mapAppointment(appointment, lines))
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: translate('appointments.status.invalid', 'Invalid appointment status.'),
          code: 'INVALID_STATUS',
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: translate('appointments.status.failed', 'Unable to update appointment status.'),
        code: 'STATUS_UPDATE_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Appointment detail and status update',
  methods: {
    GET: {
      summary: 'Get appointment detail with lines',
      responses: [
        { status: 200, description: 'Appointment detail' },
        { status: 404, description: 'Not found' },
      ],
    },
    PATCH: {
      summary: 'Update appointment status',
      requestBody: { contentType: 'application/json', schema: appointmentStatusUpdateSchema },
      responses: [
        { status: 200, description: 'Updated appointment' },
        { status: 400, description: 'Invalid status' },
        { status: 404, description: 'Not found' },
      ],
    },
  },
}
