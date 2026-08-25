import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Appointment } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
}

function mapAppointment(row: Appointment) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    customerEntityId: row.customerEntityId,
    customerName: row.customerName,
    customerPhone: row.customerPhone ?? null,
    customerEmail: row.customerEmail ?? null,
    statusCode: row.statusCode,
    requestedStartAt: row.requestedStartAt.toISOString(),
    requestedEndAt: row.requestedEndAt?.toISOString() ?? null,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(req.url)
    const organizationId = url.searchParams.get('organizationId') ?? auth.orgId ?? null
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const where: Record<string, unknown> = {
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    if (organizationId) where.organizationId = organizationId

    const rows = await em.find(Appointment, where, {
      orderBy: { requestedStartAt: 'desc' },
      limit: 100,
    })
    return NextResponse.json({ items: rows.map(mapAppointment) })
  } catch {
    return NextResponse.json(
      {
        error: translate('appointments.list.failed', 'Unable to list appointments.'),
        code: 'LIST_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Staff appointment list',
  methods: {
    GET: {
      summary: 'List appointments for the active tenant/org',
      responses: [{ status: 200, description: 'Appointment list' }],
    },
  },
}
