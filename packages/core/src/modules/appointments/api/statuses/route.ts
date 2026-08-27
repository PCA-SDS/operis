import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AppointmentStatus } from '../../data/entities'
import { appointmentStatusCatalogCreateSchema } from '../../data/validators'
import {
  isAppointmentSystemStatusCode,
  isValidAppointmentStatusCode,
  mapAppointmentStatusRow,
  normalizeAppointmentStatusCode,
} from '../../lib/statusCatalog'
import { ensureSystemAppointmentStatuses } from '../../setup'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
  POST: { requireAuth: true, requireFeatures: ['appointments.settings.manage'] },
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
      { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    )
    return NextResponse.json({
      items: rows.map(mapAppointmentStatusRow),
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

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = appointmentStatusCatalogCreateSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    await ensureSystemAppointmentStatuses(em, auth.tenantId)

    const code = normalizeAppointmentStatusCode(body.code, body.label)
    if (!isValidAppointmentStatusCode(code)) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.config.statuses.error.codeInvalid',
            'Status code must start with a letter and use lowercase letters, numbers, or underscores.',
          ),
          code: 'STATUS_CODE_INVALID',
        },
        { status: 400 },
      )
    }
    if (isAppointmentSystemStatusCode(code)) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.config.statuses.error.codeReserved',
            'That status code is reserved for a system status.',
          ),
          code: 'STATUS_CODE_RESERVED',
        },
        { status: 400 },
      )
    }

    const existing = await em.findOne(AppointmentStatus, {
      tenantId: auth.tenantId,
      code,
      deletedAt: null,
    })
    if (existing) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.config.statuses.error.codeExists',
            'A status with that code already exists.',
          ),
          code: 'STATUS_CODE_EXISTS',
        },
        { status: 409 },
      )
    }

    const row = em.create(AppointmentStatus, {
      tenantId: auth.tenantId,
      code,
      label: body.label.trim(),
      description: body.description ?? null,
      isSystem: false,
      sortOrder: body.sortOrder ?? 100,
    })
    em.persist(row)
    await em.flush()
    return NextResponse.json(mapAppointmentStatusRow(row), { status: 201 })
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
        error: translate('appointments.config.statuses.error.save', 'Unable to create status.'),
        code: 'STATUS_CREATE_FAILED',
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
    POST: {
      summary: 'Create a custom appointment status',
      responses: [
        { status: 201, description: 'Created' },
        { status: 400, description: 'Invalid input' },
        { status: 409, description: 'Code exists' },
      ],
    },
  },
}