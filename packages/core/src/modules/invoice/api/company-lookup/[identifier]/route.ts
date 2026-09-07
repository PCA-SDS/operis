import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiResponseDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_ERROR_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'

import { requireInvoiceScope, type InvoiceScope } from '../../../data/scope'
import {
  INVOICE_COMPANY_LOOKUP_RATE_LIMIT_REQUESTS,
  INVOICE_COMPANY_LOOKUP_RATE_LIMIT_WINDOW_SECONDS,
  invoiceCompanyLookupIdentifierSchema,
  invoiceCompanyLookupResultSchema,
  invoiceCompanyLookupRouteQuerySchema,
} from '../../../data/validators'
import {
  InvoiceCompanyLookupService,
  InvoiceCompanyLookupUnavailableError,
} from '../../../services/company-lookup-service'
import {
  createInvoiceOperationId,
  invoiceCommonErrors,
  invoiceErrorSchema,
} from '../../openapi'

const logger = createLogger('invoice').child({ component: 'company-lookup-api' })

const companyLookupRateLimitConfig = readEndpointRateLimitConfig('INVOICE_COMPANY_LOOKUP', {
  points: INVOICE_COMPANY_LOOKUP_RATE_LIMIT_REQUESTS,
  duration: INVOICE_COMPANY_LOOKUP_RATE_LIMIT_WINDOW_SECONDS,
  blockDuration: INVOICE_COMPANY_LOOKUP_RATE_LIMIT_WINDOW_SECONDS,
  keyPrefix: 'invoice_company_lookup',
})

export const invoiceCompanyLookupTag = 'Invoice Company Lookup'

export const invoiceCompanyLookupRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.view'],
} as const

export const metadata = {
  GET: invoiceCompanyLookupRouteMetadata,
}

const invoiceCompanyLookupParamSchema = z.object({
  identifier: invoiceCompanyLookupIdentifierSchema,
}).strict()

const invoiceCompanyLookupRouteErrors: OpenApiResponseDoc[] = [
  ...invoiceCommonErrors.filter((error) => error.status !== 409),
  { status: 429, description: 'Too many lookup requests', schema: invoiceErrorSchema },
  { status: 503, description: 'Company lookup provider unavailable and no cache exists', schema: invoiceErrorSchema },
]

type RouteContext = {
  params?: Promise<{ identifier?: string }> | { identifier?: string }
}

async function resolveContext(req: Request): Promise<{
  container: Awaited<ReturnType<typeof createRequestContainer>>
  scope: InvoiceScope
  userId: string
  translate: (key: string, fallback?: string) => string
}> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.sub || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('invoice.errors.unauthorized', 'Unauthorized') })
  }

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const selectedOrganizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  const scope = requireInvoiceScope({
    auth: { tenantId: auth.tenantId, orgId: auth.orgId },
    selectedOrganizationId,
    organizationScope: organizationScope ? { selectedId: organizationScope.selectedId ?? null } : null,
  }, (key, fallback) => translate(key, fallback))

  return { container, scope, userId: auth.sub, translate }
}

async function enforceLookupRateLimit(
  context: { scope: InvoiceScope; userId: string; translate: (key: string, fallback?: string) => string },
): Promise<NextResponse | null> {
  const service = getCachedRateLimiterService()
  if (!service) {
    logger.error('Rate limiter service is not registered for invoice company lookup', {
      keyPrefix: companyLookupRateLimitConfig.keyPrefix,
    })
    return NextResponse.json(
      { error: context.translate('api.errors.rateLimitUnavailable', 'Service temporarily unavailable. Please try again later.') },
      { status: 503 },
    )
  }

  return checkRateLimit(
    service,
    companyLookupRateLimitConfig,
    `${context.scope.tenantId}:${context.userId}`,
    context.translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK),
    {
      failClosed: true,
      unavailableMessage: context.translate(
        'api.errors.rateLimitUnavailable',
        'Service temporarily unavailable. Please try again later.',
      ),
    },
  )
}

export async function GET(req: Request, routeContext: RouteContext = {}) {
  try {
    const paramsValue = routeContext.params ? await routeContext.params : {}
    const params = invoiceCompanyLookupParamSchema.parse({ identifier: paramsValue.identifier })
    const url = new URL(req.url)
    const query = invoiceCompanyLookupRouteQuerySchema.parse({
      country: url.searchParams.get('country') ?? undefined,
    })
    const context = await resolveContext(req)
    const rateLimitResponse = await enforceLookupRateLimit(context)
    if (rateLimitResponse) return rateLimitResponse

    const service = context.container.resolve<InvoiceCompanyLookupService>('invoiceCompanyLookupService')
    const result = await service.lookup(context.scope, {
      country: query.country,
      identifier: params.identifier,
    })

    return NextResponse.json(invoiceCompanyLookupResultSchema.parse(result))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })

    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
    }

    if (err instanceof InvoiceCompanyLookupUnavailableError) {
      return NextResponse.json(
        { error: translate('invoice.errors.company_lookup_unavailable', 'Company lookup is temporarily unavailable') },
        { status: 503 },
      )
    }

    logger.error('Invoice company lookup route failed', { err })
    return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceCompanyLookupTag,
  summary: 'Look up an invoice company by registry identifier',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('companyLookup', 'get'),
      summary: 'Look up an invoice company',
      description: 'Returns normalized registry data for invoice form autofill without creating an invoice partner.',
      pathParams: invoiceCompanyLookupParamSchema,
      query: invoiceCompanyLookupRouteQuerySchema,
      responses: [
        { status: 200, description: 'Company lookup result', schema: invoiceCompanyLookupResultSchema },
      ],
      errors: invoiceCompanyLookupRouteErrors,
    },
  },
}
