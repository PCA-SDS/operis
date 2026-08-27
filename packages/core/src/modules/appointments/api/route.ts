import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Appointment } from '../data/entities'
import { appointmentStaffCreateSchema } from '../data/validators'
import { createAppointmentFromPublicIntake } from '../lib/intake'
import { emitAppointmentEvent } from '../events'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
  POST: { requireAuth: true, requireFeatures: ['appointments.create'] },
}

function mapAppointment(row: Appointment, organizationName: string | null = null) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    organizationName,
    customerEntityId: row.customerEntityId,
    customerName: row.customerName,
    customerSalutation: row.customerSalutation ?? null,
    customerPhone: row.customerPhone ?? null,
    customerEmail: row.customerEmail ?? null,
    customerPhoneCountryCode: row.customerPhoneCountryCode ?? null,
    customerOrigin: row.customerOrigin ?? null,
    bookingType: row.bookingType ?? null,
    statusCode: row.statusCode,
    requestedStartAt: row.requestedStartAt.toISOString(),
    requestedEndAt: row.requestedEndAt?.toISOString() ?? null,
    notes: row.notes ?? null,
    externalNotes: row.externalNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function resolveOrganizationNames(
  em: EntityManager,
  organizationIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(organizationIds.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map()
  const organizations = await em.find(Organization, {
    id: { $in: uniqueIds },
    deletedAt: null,
  })
  return new Map(
    organizations.map((org) => {
      const id = String(org.id)
      const name = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : id
      return [id, name]
    }),
  )
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
    const statusCode = url.searchParams.get('statusCode')?.trim() || null
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const where: Record<string, unknown> = {
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    if (organizationId) where.organizationId = organizationId
    if (statusCode) where.statusCode = statusCode

    const rows = await em.find(Appointment, where, {
      orderBy: { requestedStartAt: 'desc' },
      limit: 100,
    })
    const orgNames = await resolveOrganizationNames(
      em,
      rows.map((row) => row.organizationId),
    )
    return NextResponse.json({
      items: rows.map((row) =>
        mapAppointment(row, orgNames.get(row.organizationId) ?? null),
      ),
    })
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

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = appointmentStaffCreateSchema.parse(await req.json())
    const organizationId = body.organizationId ?? auth.orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.create.scopeRequired',
            'Active tenant and organization are required.',
          ),
          code: 'SCOPE_REQUIRED',
        },
        { status: 400 },
      )
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const { organizationId: _ignoredOrganizationId, ...intakeBody } = body
    const result = await createAppointmentFromPublicIntake(em, {
      ...intakeBody,
      tenantId: auth.tenantId,
      organizationId,
    })
    try {
      await emitAppointmentEvent('appointments.appointment.created', {
        id: result.id,
        tenantId: auth.tenantId,
        organizationId,
      })
    } catch {
      /* best-effort */
    }
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: translate('appointments.create.invalidInput', 'Invalid appointment payload.'),
          code: 'INVALID_INPUT',
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: translate('appointments.create.failed', 'Unable to create appointment.'),
        code: 'CREATE_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Staff appointment list and create',
  methods: {
    GET: {
      summary: 'List appointments for the active tenant/org',
      responses: [{ status: 200, description: 'Appointment list' }],
    },
    POST: {
      summary: 'Create appointment (staff)',
      description:
        'Uses authenticated tenant/org. Find-or-creates customer, validates bookable services, stores snapshots, status new_request.',
      requestBody: { contentType: 'application/json', schema: appointmentStaffCreateSchema },
      responses: [
        { status: 201, description: 'Created' },
        { status: 400, description: 'Invalid input or missing scope' },
      ],
    },
  },
}
