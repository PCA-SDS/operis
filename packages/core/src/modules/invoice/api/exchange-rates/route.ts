import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { INVOICE_CURRENCY_CODES } from '../../data/entities'
import { requireInvoiceScope } from '../../data/scope'
import {
  InvoiceExchangeRatesService,
  InvoiceExchangeRatesUnavailableError,
  type InvoiceExchangeRatesDto,
} from '../../services/exchange-rates-service'
import {
  createInvoiceOperationId,
  invoiceCommonErrors,
  invoiceErrorSchema,
} from '../openapi'

const logger = createLogger('invoice').child({ component: 'exchange-rates-api' })

export const invoiceExchangeRatesTag = 'Invoice Exchange Rates'

export const invoiceExchangeRateRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.view'],
} as const

export const metadata = {
  GET: invoiceExchangeRateRouteMetadata,
}

const invoiceExchangeRateItemSchema = z.object({
  currencyCode: z.enum(INVOICE_CURRENCY_CODES),
  vndPerUnit: z.number().finite().positive(),
})

export const invoiceExchangeRatesResponseSchema = z.object({
  baseCurrency: z.literal('VND'),
  fetchedAt: z.string().datetime(),
  stale: z.boolean(),
  rates: z.record(z.enum(INVOICE_CURRENCY_CODES), invoiceExchangeRateItemSchema),
})

const invoiceExchangeRateRouteErrors: OpenApiResponseDoc[] = [
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
  requireInvoiceScope({
    auth: { tenantId: auth.tenantId, orgId: auth.orgId },
    selectedOrganizationId,
    organizationScope: organizationScope ? { selectedId: organizationScope.selectedId ?? null } : null,
  }, (key, fallback) => translate(key, fallback))

  return { container, translate }
}

export async function GET(req: Request) {
  try {
    const context = await resolveContext(req)
    const service = context.container.resolve<InvoiceExchangeRatesService>('invoiceExchangeRatesService')
    const rates = await service.getRates()

    return NextResponse.json(rates satisfies InvoiceExchangeRatesDto)
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

    logger.error('Invoice exchange rates route failed', { err })
    return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceExchangeRatesTag,
  summary: 'Get invoice exchange rates',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('exchangeRates', 'get'),
      summary: 'Get invoice exchange rates',
      description: 'Returns VND conversion hints for supported invoice currencies.',
      responses: [
        { status: 200, description: 'Invoice exchange rates', schema: invoiceExchangeRatesResponseSchema },
      ],
      errors: invoiceExchangeRateRouteErrors,
    },
  },
}
