import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AppointmentStatus } from '../../data/entities'
import { ensureSystemAppointmentStatuses } from '../../setup'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    await ensureSystemAppointmentStatuses(em, auth.tenantId)
    const rows = await em.find(
      AppointmentStatus,
      { tenantId: auth.tenantId, deletedAt: null },
      { orderBy: { sortOrder: 'asc' } },
    )
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        label: row.label,
        description: row.description ?? null,
        isSystem: row.isSystem,
        sortOrder: row.sortOrder,
      })),
    })
  } catch {
    return NextResponse.json(
      {
        error: translate('appointments.statuses.failed', 'Unable to list appointment statuses.'),
        code: 'STATUSES_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Appointment status catalog',
  methods: {
    GET: {
      summary: 'List appointment statuses for the active tenant',
      responses: [{ status: 200, description: 'Status catalog' }],
    },
  },
}
