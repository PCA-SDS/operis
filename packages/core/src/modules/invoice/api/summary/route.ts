import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { translateInvoiceErrorBody } from '../../data/errors'
import { invoiceSummaryQuerySchema } from '../../data/validators'
import type { InvoiceSummaryDto } from '../../data/mappers'
import { InvoiceService } from '../../services/invoice-service'
import { InvoiceExchangeRatesUnavailableError } from '../../services/exchange-rates-service'
import {
  createInvoiceOperationId,
  invoiceCommonErrors,
  invoiceErrorSchema,
  invoiceTag,
} from '../openapi'
import { resolveInvoiceScopeContext } from '../routeContext'

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
  unpaidInvoices: z.number().int().nonnegative(),
  partiallyPaidInvoices: z.number().int().nonnegative(),
  paidInvoices: z.number().int().nonnegative(),
  unreceivedInvoices: z.number().int().nonnegative(),
  receivedInvoices: z.number().int().nonnegative(),
  nonRecoverableInvoices: z.number().int().nonnegative(),
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

export async function GET(req: Request) {
  try {
    const context = await resolveInvoiceScopeContext(req)
    const { searchParams } = new URL(req.url)
    const queryInput = invoiceSummaryQuerySchema.parse({
      throughDate: searchParams.get('throughDate') ?? undefined,
    })
    const service = context.container.resolve<InvoiceService>('invoiceService')
    const summary = queryInput.throughDate
      ? await service.getSummary(context.scope, queryInput)
      : await service.getSummary(context.scope)

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
      query: invoiceSummaryQuerySchema,
      responses: [
        { status: 200, description: 'Invoice summary', schema: invoiceSummaryResponseSchema },
      ],
      errors: invoiceSummaryRouteErrors,
    },
  },
}
