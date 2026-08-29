import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_FALLBACK_KEY,
  rateLimitErrorSchema,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { personCheckSchema } from '../../../data/validators'
import { checkPersonIdentity } from '../../../lib/personLookup'

const logger = createLogger('customers')

export const metadata = {
  POST: { requireAuth: false },
}

const personCheckRateLimitConfig = readEndpointRateLimitConfig('CUSTOMERS_PEOPLE_CHECK', {
  points: 10,
  duration: 60,
  blockDuration: 300,
  keyPrefix: 'customers_people_check',
})

const successSchema = z.object({
  exists: z.boolean(),
})

/**
 * Public "do we already know you?" probe for booking intake.
 *
 * The response is intentionally a bare boolean. An anonymous caller supplies the
 * tenant, so returning customer fields here would hand contact details to anyone
 * who can guess a phone number; a booking flow that wants to prefill must first
 * verify the caller owns the number.
 */
export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      const clientIp = getClientIp(req, rateLimiterService.trustProxyDepth)
      const rateLimitResponse = await checkRateLimit(
        rateLimiterService,
        personCheckRateLimitConfig,
        clientIp ?? RATE_LIMIT_FALLBACK_KEY,
        translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
      )
      if (rateLimitResponse) return rateLimitResponse
    } else {
      logger.error('Rate limiter service is not registered — check RATE_LIMIT_* configuration; people check is not rate limited')
    }

    const body = personCheckSchema.parse(await req.json())
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await checkPersonIdentity(
      em,
      { tenantId: body.tenantId },
      { phone: body.phone, email: body.email },
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
    logger.error('people check failed', { component: 'people.check', err: error })
    return NextResponse.json(
      { error: translate('customers.people.check.failed', 'Unable to check customer.'), code: 'CHECK_FAILED' },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Check whether a person already exists for booking intake',
  methods: {
    POST: {
      summary: 'Report whether a person matches the given phone and/or email within a tenant',
      description:
        'Public booking helper. Lookup is tenant-wide (customers are shared across organizations/branches) and matches on deterministic contact hashes. Returns existence only — no customer fields are disclosed to unauthenticated callers. Rate limited per client IP.',
      requestBody: { contentType: 'application/json', schema: personCheckSchema },
      responses: [
        { status: 200, description: 'Lookup result', schema: successSchema },
        { status: 400, description: 'Invalid input' },
        { status: 409, description: 'Phone and email match different people' },
        { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
      ],
    },
  },
}
