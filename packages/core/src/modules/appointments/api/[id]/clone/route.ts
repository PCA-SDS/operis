import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { Appointment, AppointmentLine, AppointmentStatus } from '../../../data/entities'
import { emitAppointmentEvent } from '../../../events'
import { DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE } from '../../../data/constants'
import { ensureSystemAppointmentStatuses } from '../../../setup'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['appointments.create'] },
}

type RouteContext = { params: Promise<{ id: string }> }

async function loadScopedAppointment(
  em: EntityManager,
  tenantId: string,
  id: string,
  orgWhere: Record<string, unknown>,
): Promise<Appointment | null> {
  return em.findOne(Appointment, {
    id,
    tenantId,
    ...orgWhere,
    deletedAt: null,
  })
}

export async function POST(req: Request, ctx: RouteContext) {
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
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const orgFilter = resolveOrganizationScopeFilter(scope, auth)
    
    const existingAppointment = await loadScopedAppointment(em, auth.tenantId, id, orgFilter.where)
    if (!existingAppointment) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const existingLines = await em.find(
      AppointmentLine,
      { appointment: existingAppointment.id, deletedAt: null },
      { orderBy: { sortOrder: 'asc' } },
    )

    await ensureSystemAppointmentStatuses(em, auth.tenantId)
    const newStatus = await em.findOne(AppointmentStatus, {
      tenantId: auth.tenantId,
      code: DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE,
      deletedAt: null,
    })

    if (!newStatus) {
      return NextResponse.json(
        { error: translate('appointments.status.missing', 'Default appointment status is missing.'), code: 'STATUS_MISSING' },
        { status: 500 },
      )
    }

    const newAppointment = em.create(Appointment, {
      tenantId: existingAppointment.tenantId,
      organizationId: existingAppointment.organizationId,
      customerEntityId: existingAppointment.customerEntityId,
      customerName: existingAppointment.customerName,
      customerSalutation: existingAppointment.customerSalutation,
      customerEmail: existingAppointment.customerEmail,
      customerPhone: existingAppointment.customerPhone,
      customerPhoneCountryCode: existingAppointment.customerPhoneCountryCode,
      customerPhoneCountry: existingAppointment.customerPhoneCountry,
      customerOrigin: existingAppointment.customerOrigin,
      bookingType: existingAppointment.bookingType,
      status: newStatus,
      statusCode: newStatus.code,
      requestedStartAt: existingAppointment.requestedStartAt,
      requestedEndAt: existingAppointment.requestedEndAt,
      notes: existingAppointment.notes,
      externalNotes: existingAppointment.externalNotes,
    })
    em.persist(newAppointment)

    for (const line of existingLines) {
      em.persist(
        em.create(AppointmentLine, {
          appointment: newAppointment,
          tenantId: line.tenantId,
          organizationId: line.organizationId,
          productId: line.productId,
          productTitle: line.productTitle,
          productHandle: line.productHandle,
          currencyCode: line.currencyCode,
          unitPriceNet: line.unitPriceNet,
          unitPriceGross: line.unitPriceGross,
          durationMinutes: line.durationMinutes,
          productCategory: line.productCategory,
          selectedOptions: line.selectedOptions,
          sortOrder: line.sortOrder,
        }),
      )
    }

    await em.flush()

    try {
      await emitAppointmentEvent('appointments.appointment.created', {
        id: newAppointment.id,
        tenantId: auth.tenantId,
        organizationId: newAppointment.organizationId,
      })
    } catch {
      /* best-effort */
    }

    return NextResponse.json({ success: true, id: newAppointment.id })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    return NextResponse.json(
      { error: translate('appointments.clone.failed', 'Unable to clone appointment.'), code: 'CLONE_FAILED' },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Clone an existing appointment',
  methods: {
    POST: {
      summary: 'Clone appointment',
      responses: [
        { status: 200, description: 'Cloned successfully' },
        { status: 404, description: 'Not found' },
      ],
    },
  },
}