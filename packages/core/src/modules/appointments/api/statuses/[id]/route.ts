import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Appointment, AppointmentStatus } from '../../../data/entities'
import { appointmentStatusCatalogUpdateSchema } from '../../../data/validators'
import {
  isAppointmentSystemStatusCode,
  mapAppointmentStatusRow,
} from '../../../lib/statusCatalog'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['appointments.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['appointments.settings.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> | { id?: string } }

async function resolveId(context: RouteContext): Promise<string | null> {
  const params = await context.params
  const id = typeof params?.id === 'string' ? params.id.trim() : ''
  return id || null
}

async function findActiveStatus(em: EntityManager, tenantId: string, id: string) {
  return em.findOne(AppointmentStatus, {
    id,
    tenantId,
    deletedAt: null,
  })
}

export async function PATCH(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const id = await resolveId(context)
    if (!id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const body = appointmentStatusCatalogUpdateSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const row = await findActiveStatus(em, auth.tenantId, id)
    if (!row) {
      return NextResponse.json(
        {
          error: translate('appointments.config.statuses.error.notFound', 'Status not found.'),
          code: 'STATUS_NOT_FOUND',
        },
        { status: 404 },
      )
    }

    const isSystem = row.isSystem || isAppointmentSystemStatusCode(row.code)
    if (
      isSystem &&
      body.label !== undefined &&
      body.label.trim() !== row.label
    ) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.config.statuses.error.systemRename',
            'System status names cannot be renamed.',
          ),
          code: 'STATUS_SYSTEM_RENAME',
        },
        { status: 400 },
      )
    }

    if (body.label !== undefined && !isSystem) {
      row.label = body.label.trim()
    }
    if (body.description !== undefined) {
      row.description = body.description
    }
    if (body.sortOrder !== undefined) {
      row.sortOrder = body.sortOrder
    }
    await em.flush()
    return NextResponse.json(mapAppointmentStatusRow(row))
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') {
      return NextResponse.json(
        {
          error: translate('appointments.config.statuses.error.invalid', 'Invalid status payload.'),
          code: 'STATUS_INVALID',
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: translate('appointments.config.statuses.error.save', 'Unable to update status.'),
        code: 'STATUS_UPDATE_FAILED',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const id = await resolveId(context)
    if (!id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const row = await findActiveStatus(em, auth.tenantId, id)
    if (!row) {
      return NextResponse.json(
        {
          error: translate('appointments.config.statuses.error.notFound', 'Status not found.'),
          code: 'STATUS_NOT_FOUND',
        },
        { status: 404 },
      )
    }
    if (row.isSystem || isAppointmentSystemStatusCode(row.code)) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.config.statuses.error.systemDelete',
            'System statuses cannot be deleted.',
          ),
          code: 'STATUS_SYSTEM_DELETE',
        },
        { status: 400 },
      )
    }

    const inUse = await em.count(Appointment, {
      tenantId: auth.tenantId,
      status: row,
      deletedAt: null,
    })
    if (inUse > 0) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.config.statuses.error.inUse',
            'This status is still used by appointments and cannot be deleted.',
          ),
          code: 'STATUS_IN_USE',
        },
        { status: 409 },
      )
    }

    row.deletedAt = new Date()
    await em.flush()
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json(
      {
        error: translate('appointments.config.statuses.error.delete', 'Unable to delete status.'),
        code: 'STATUS_DELETE_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Appointment status catalog item',
  methods: {
    PATCH: {
      summary: 'Update an appointment status',
      responses: [
        { status: 200, description: 'Updated' },
        { status: 400, description: 'Invalid or system rename' },
        { status: 404, description: 'Not found' },
      ],
    },
    DELETE: {
      summary: 'Soft-delete a custom appointment status',
      responses: [
        { status: 204, description: 'Deleted' },
        { status: 400, description: 'System status' },
        { status: 404, description: 'Not found' },
        { status: 409, description: 'In use' },
      ],
    },
  },
}
