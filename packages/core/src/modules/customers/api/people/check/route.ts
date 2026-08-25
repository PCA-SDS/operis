import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { personCheckSchema } from '../../../data/validators'
import { checkPersonIdentity } from '../../../lib/personLookup'

export const metadata = {
  POST: { requireAuth: false },
}

const successSchema = z.object({
  exists: z.boolean(),
  customer: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      salutation: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      phoneCountryCode: z.string().nullable(),
      phoneCountry: z.string().nullable(),
      source: z.string().nullable(),
    })
    .nullable(),
  lastBooking: z.null(),
})

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const body = personCheckSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await checkPersonIdentity(
      em,
      { tenantId: body.tenantId, organizationId: body.organizationId },
      {
        phone: body.phone,
        email: body.email,
        phoneCountryCode: body.phoneCountryCode,
        phoneCountry: body.phoneCountry,
      },
    )
    return NextResponse.json(result)
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('customers.people.check.invalidInput', 'Invalid request payload.'), code: 'INVALID_INPUT' },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: translate('customers.people.check.failed', 'Unable to check customer.'), code: 'CHECK_FAILED' },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Check returning customer for booking intake',
  methods: {
    POST: {
      summary: 'Find person by phone and/or email',
      description:
        'Public booking helper. Requires tenantId and organizationId. Returns lastBooking as null until appointments module ships.',
      requestBody: { contentType: 'application/json', schema: personCheckSchema },
      responses: [
        { status: 200, description: 'Lookup result', schema: successSchema },
        { status: 400, description: 'Invalid input' },
        { status: 409, description: 'Phone and email match different people' },
      ],
    },
  },
}
