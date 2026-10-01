import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { appointmentStaffCustomerLookupSchema } from '../../data/validators'
import { lookupReturningCustomerForAppointment } from '../../lib/intake'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['appointments.create'] },
}

const successSchema = z.object({
  lastBooking: z.object({
    organizationId: z.string().uuid(),
    requestedStartAt: z.string().datetime({ offset: true }),
    serviceLines: z.array(
      z.object({
        productId: z.string().uuid(),
        selectedOptions: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]).nullable(),
      }),
    ),
  }).nullable(),
})

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: translate('appointments.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const body = appointmentStaffCustomerLookupSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await lookupReturningCustomerForAppointment(em, { ...body, tenantId: auth.tenantId })

    return NextResponse.json({ lastBooking: result.lastBooking })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('appointments.public.customer.invalidInput', 'Invalid customer lookup payload.'), code: 'INVALID_INPUT' },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: translate('appointments.public.customer.failed', 'Unable to look up customer.'), code: 'LOOKUP_FAILED' },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Staff customer booking history',
  methods: {
    POST: {
      summary: 'Find the latest booking services for a customer',
      description: 'Requires appointment-create permission and returns the latest appointment service lines across the authenticated tenant.',
      requestBody: { contentType: 'application/json', schema: appointmentStaffCustomerLookupSchema },
      responses: [
        { status: 200, description: 'Latest appointment service lines', schema: successSchema },
        { status: 400, description: 'Invalid input' },
        { status: 401, description: 'Unauthorized' },
        { status: 409, description: 'Phone and email match different people' },
      ],
    },
  },
}
