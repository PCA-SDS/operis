import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { translateInvoiceErrorBody } from '../../data/errors'
import { requireInvoiceScope } from '../../data/scope'
import type { InvoiceSummaryDto } from '../../data/mappers'
import { InvoiceService } from '../../services/invoice-service'
import { InvoiceExchangeRatesUnavailableError } from '../../services/exchange-rates-service'
import {
  createInvoiceOperationId,
  invoiceCommonErrors,
  invoiceErrorSchema,
  invoiceTag,
} from '../openapi'

const logger = createLogger('invoice').child({ component: 'summary-api' })

export const invoiceSummaryTag = invoiceTag

export const invoiceSummaryRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.view'],
} as const

export const metadata = {
  GET: invoiceSummaryRouteMetadata,
}

const invoiceDirectionSummarySchema = z.object({
  outstanding: z.string(),
  settled: z.string(),
  net: z.string(),
  total: z.string(),
  outstandingAmount: z.string(),
  settledAmount: z.string(),
  totalAmount: z.string(),
  nonRecoverableAmount: z.string().optional(),
})

export const invoiceSummaryResponseSchema = z.object({
  currency: z.literal('VND'),
  ar: invoiceDirectionSummarySchema,
  ap: invoiceDirectionSummarySchema,
  netPosition: z.string(),
  net: z.string(),
  netOutstanding: z.string(),
  ratesStale: z.boolean(),
})

const invoiceSummaryRouteErrors: OpenApiResponseDoc[] = [
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
    const service = context.container.resolve<InvoiceService>('invoiceService')
    const summary = await service.getSummary(context.scope)

    return NextResponse.json(summary satisfies InvoiceSummaryDto)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) {
      return NextResponse.json(translateInvoiceErrorBody(err.body, translate), { status: err.status })
    }

    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
    }

    if (err instanceof InvoiceExchangeRatesUnavailableError) {
      return NextResponse.json(
        { error: translate('invoice.errors.exchange_rates_unavailable', 'Exchange rates are temporarily unavailable') },
        { status: 503 },
      )
    }

    logger.error('Invoice summary route failed', { err })
    return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceSummaryTag,
  summary: 'Get invoice summary',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('summary', 'get'),
      summary: 'Get invoice summary',
      description: 'Returns VND-normalized AP/AR outstanding, settled, and net values.',
      responses: [
        { status: 200, description: 'Invoice summary', schema: invoiceSummaryResponseSchema },
      ],
      errors: invoiceSummaryRouteErrors,
    },
  },
}

