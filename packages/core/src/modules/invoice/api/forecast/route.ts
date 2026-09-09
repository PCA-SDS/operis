import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { requireInvoiceScope } from '../../data/scope'
import type { InvoiceForecastDto } from '../../data/mappers'
import { invoiceForecastQuerySchema } from '../../data/validators'
import { InvoiceService } from '../../services/invoice-service'
import { InvoiceExchangeRatesUnavailableError } from '../../services/exchange-rates-service'
import {
  createInvoiceOperationId,
  invoiceCommonErrors,
  invoiceErrorSchema,
  invoiceTag,
} from '../openapi'

const logger = createLogger('invoice').child({ component: 'forecast-api' })

export const invoiceForecastTag = invoiceTag

export const invoiceForecastRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.view'],
} as const

export const metadata = {
  GET: invoiceForecastRouteMetadata,
}

const invoiceForecastEntrySchema = z.object({
  date: z.string(),
  direction: z.enum(['AR', 'AP']),
  amountVnd: z.string(),
  invoiceId: z.string().uuid(),
  installmentId: z.string().uuid().nullable(),
  invoiceNumber: z.string().nullable(),
  partnerName: z.string().nullable(),
})

const invoiceForecastSeriesPointSchema = z.object({
  date: z.string(),
  arAmount: z.string(),
  apAmount: z.string(),
  netAmount: z.string(),
})

export const invoiceForecastResponseSchema = z.object({
  currency: z.literal('VND'),
  ratesStale: z.boolean(),
  entries: z.array(invoiceForecastEntrySchema),
  series: z.array(invoiceForecastSeriesPointSchema),
  totals: z.object({
    arAmount: z.string(),
    apAmount: z.string(),
    netAmount: z.string(),
  }),
})

const invoiceForecastRouteErrors: OpenApiResponseDoc[] = [
  ...invoiceCommonErrors.filter((error) => error.status !== 404 && error.status !== 409),
  { status: 503, description: 'Exchange rate provider unavailable and no cache exists', schema: invoiceErrorSchema },
]

async function resolveContext(req: Request) {
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

  return { container, translate, scope }
}

export async function GET(req: Request) {
  try {
    const context = await resolveContext(req)
    const { searchParams } = new URL(req.url)
    const rawThroughDate = searchParams.get('throughDate')
    const queryInput = invoiceForecastQuerySchema.parse({
      throughDate: rawThroughDate ?? undefined,
    })

    const service = context.container.resolve<InvoiceService>('invoiceService')
    const forecast = await service.getForecast(context.scope, queryInput)

    return NextResponse.json(forecast satisfies InvoiceForecastDto)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })

    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
    }

    if (err instanceof InvoiceExchangeRatesUnavailableError) {
      return NextResponse.json(
        { error: translate('invoice.errors.exchange_rates_unavailable', 'Exchange rates are temporarily unavailable') },
        { status: 503 },
      )
    }

    logger.error('Invoice forecast route failed', { err })
    return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceForecastTag,
  summary: 'Get invoice cash-flow forecast',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('forecast', 'get'),
      summary: 'Get invoice cash-flow forecast',
      description: 'Returns VND-normalized cash-flow forecast entries, daily series, and totals.',
      parameters: [
        {
          name: 'throughDate',
          in: 'query',
          description: 'Optional forecast horizon limit (ISO date, default 12 months ahead).',
          required: false,
          schema: { type: 'string', format: 'date' },
        },
      ],
      responses: [
        { status: 200, description: 'Invoice cash-flow forecast', schema: invoiceForecastResponseSchema },
      ],
      errors: invoiceForecastRouteErrors,
    },
  },
}

