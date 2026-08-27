import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { appointmentPublicCreateSchema } from '../../../data/validators'
import { createAppointmentFromPublicIntake } from '../../../lib/intake'
import { emitAppointmentEvent } from '../../../events'

export const metadata = {
  POST: { requireAuth: false },
}

const successSchema = z.object({
  id: z.string().uuid(),
  statusCode: z.string(),
  customerEntityId: z.string().uuid(),
  customerCreated: z.boolean(),
  requestedStartAt: z.string(),
  requestedEndAt: z.string().nullable(),
  lineCount: z.number().int(),
})

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const body = appointmentPublicCreateSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await createAppointmentFromPublicIntake(em, body)
    try {
      await emitAppointmentEvent('appointments.appointment.created', {
        id: result.id,
        tenantId: body.tenantId,
        organizationId: body.organizationId,
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
          error: translate('appointments.public.create.invalidInput', 'Invalid appointment payload.'),
          code: 'INVALID_INPUT',
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: translate('appointments.public.create.failed', 'Unable to create appointment.'),
        code: 'CREATE_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Public appointment intake',
  methods: {
    POST: {
      summary: 'Create appointment (public)',
      description:
        'Requires tenantId + organizationId + requestedStartAt. Find-or-creates the customer (tenant-wide), validates bookable services for the org, stores customer + line snapshots, and sets status new_request.',
      requestBody: { contentType: 'application/json', schema: appointmentPublicCreateSchema },
      responses: [
        { status: 201, description: 'Created', schema: successSchema },
        { status: 400, description: 'Invalid input or service not bookable' },
        { status: 404, description: 'Tenant or organization not found' },
      ],
    },
  },
}
