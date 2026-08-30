import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_FALLBACK_KEY,
  rateLimitErrorSchema,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { bookableServicesQuerySchema } from '../../data/validators'
import { listBookableServicesForOrganization } from '../../lib/bookableServices'
import type { CatalogPricingService } from '../../services/catalogPricingService'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: false },
}

// Anonymous callers reach this list, and each request fans out to product,
// price and custom-field reads. Throttle per client IP like the other public
// booking-intake endpoints.
const bookableServicesRateLimitConfig = readEndpointRateLimitConfig('CATALOG_BOOKABLE_SERVICES', {
  points: 60,
  duration: 60,
  blockDuration: 300,
  keyPrefix: 'catalog_bookable_services',
})

const bookableServiceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string().nullable(),
  description: z.string().nullable(),
  handle: z.string().nullable(),
  currencyCode: z.string().nullable(),
  unitPriceNet: z.string().nullable(),
  unitPriceGross: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

const successSchema = z.object({
  items: z.array(bookableServiceSchema),
})

function parseQuery(url: URL) {
  return bookableServicesQuerySchema.parse({
    tenantId: url.searchParams.get('tenantId') ?? undefined,
    organizationId: url.searchParams.get('organizationId') ?? undefined,
  })
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      const clientIp = getClientIp(req, rateLimiterService.trustProxyDepth)
      const rateLimitResponse = await checkRateLimit(
        rateLimiterService,
        bookableServicesRateLimitConfig,
        clientIp ?? RATE_LIMIT_FALLBACK_KEY,
        translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
      )
      if (rateLimitResponse) return rateLimitResponse
    } else {
      logger.error('Rate limiter service is not registered — check RATE_LIMIT_* configuration; bookable services is not rate limited')
    }

    const query = parseQuery(new URL(req.url))
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const pricingService = container.resolve<CatalogPricingService>('catalogPricingService')
    const items = await listBookableServicesForOrganization(
      em,
      { tenantId: query.tenantId, organizationId: query.organizationId },
      { pricingService },
    )
    return NextResponse.json({ items })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: translate(
            'catalog.bookableServices.invalidInput',
            'tenantId and organizationId are required.',
          ),
          code: 'INVALID_INPUT',
        },
        { status: 400 },
      )
    }
    logger.error('bookable services listing failed', { component: 'bookableServices', err: error })
    return NextResponse.json(
      {
        error: translate(
          'catalog.bookableServices.failed',
          'Unable to list bookable services.',
        ),
        code: 'LIST_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'List bookable services for appointment booking',
  methods: {
    GET: {
      summary: 'List active services for a tenant organization (branch)',
      description:
        'Public booking helper. Requires explicit tenantId + organizationId. Returns active catalog products with custom fieldset `service_schedule` for that organization only (decision A: load catalog by branch). Prices resolve through `catalogPricingService`, so a service with no price applicable to an anonymous caller reports null amounts; quote-only products never report a price. Staff enable services via Catalog UI in the branch org; demo data comes from catalog seedExamples. Rate limited per client IP.',
      query: bookableServicesQuerySchema,
      responses: [
        { status: 200, description: 'Bookable services', schema: successSchema },
        { status: 400, description: 'Invalid input' },
        { status: 404, description: 'Tenant or organization not found' },
        { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
      ],
    },
  },
}
