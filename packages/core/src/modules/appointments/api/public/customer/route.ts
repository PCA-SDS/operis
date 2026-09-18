import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { publicCorsHeaders, withPublicCorsHeaders } from '@open-mercato/shared/lib/http/cors'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_FALLBACK_KEY,
  rateLimitErrorSchema,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { appointmentPublicCustomerLookupSchema } from '../../../data/validators'
import { lookupPublicCustomerForAppointment } from '../../../lib/intake'

export const metadata = {
  POST: { requireAuth: false },
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: publicCorsHeaders(req) })
}

const publicCustomerLookupRateLimitConfig = readEndpointRateLimitConfig('APPOINTMENTS_PUBLIC_CUSTOMER_LOOKUP', {
  points: 10,
  duration: 60,
  blockDuration: 300,
  keyPrefix: 'appointments_public_customer_lookup',
})

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
      origin: z.string().nullable(),
      organizationId: z.string().uuid(),
    })
    .nullable(),
  lastBooking: z
    .object({
      organizationId: z.string().uuid(),
      requestedStartAt: z.string().datetime({ offset: true }),
      serviceLines: z.array(
        z.object({
          productId: z.string().uuid(),
          selectedOptions: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]).nullable(),
        }),
      ),
    })
    .nullable(),
})

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      const clientIp = getClientIp(req, rateLimiterService.trustProxyDepth)
      const rateLimitResponse = await checkRateLimit(
        rateLimiterService,
        publicCustomerLookupRateLimitConfig,
        clientIp ?? RATE_LIMIT_FALLBACK_KEY,
        translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
      )
      if (rateLimitResponse) return withPublicCorsHeaders(rateLimitResponse, req)
    }

    const body = appointmentPublicCustomerLookupSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await lookupPublicCustomerForAppointment(em, body)
    return NextResponse.json(result, { headers: publicCorsHeaders(req) })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status, headers: publicCorsHeaders(req) })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('appointments.public.customer.invalidInput', 'Invalid customer lookup payload.'), code: 'INVALID_INPUT' },
        { status: 400, headers: publicCorsHeaders(req) },
      )
    }
    return NextResponse.json(
      { error: translate('appointments.public.customer.failed', 'Unable to look up customer.'), code: 'LOOKUP_FAILED' },
      { status: 500, headers: publicCorsHeaders(req) },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Public returning-customer lookup',
  methods: {
    POST: {
      summary: 'Find a returning customer and latest appointment',
      description: 'Matches phone and email within the tenant and returns the latest appointment service lines for repeat booking.',
      requestBody: { contentType: 'application/json', schema: appointmentPublicCustomerLookupSchema },
      responses: [
        { status: 200, description: 'Lookup result', schema: successSchema },
        { status: 400, description: 'Invalid input' },
        { status: 409, description: 'Phone and email match different people' },
        { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
      ],
    },
  },
}
