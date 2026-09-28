import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { translateInvoiceErrorBody } from '../../data/errors'
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
import { resolveInvoiceScopeContext } from '../routeContext'

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

const invoiceForecastBucketSchema = z.object({
  amount: z.string(),
  count: z.number().int().nonnegative(),
})

const invoiceForecastSeriesPointSchema = z.object({
  date: z.string(),
  amount: z.string(),
  count: z.number().int().nonnegative(),
  cumulative: z.string(),
  arAmount: z.string(),
  apAmount: z.string(),
  netAmount: z.string(),
})

export const invoiceForecastResponseSchema = z.object({
  currency: z.literal('VND'),
  ratesStale: z.boolean(),
  today: z.string(),
  horizonDays: z.number().int().nonnegative(),
  entries: z.array(invoiceForecastEntrySchema),
  receivable: z.object({ overdue: invoiceForecastBucketSchema, undated: invoiceForecastBucketSchema, beyondHorizon: invoiceForecastBucketSchema, points: z.array(invoiceForecastSeriesPointSchema) }),
  payable: z.object({ overdue: invoiceForecastBucketSchema, undated: invoiceForecastBucketSchema, beyondHorizon: invoiceForecastBucketSchema, points: z.array(invoiceForecastSeriesPointSchema) }),
  net: z.object({ points: z.array(invoiceForecastSeriesPointSchema) }),
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

export async function GET(req: Request) {
  try {
    const context = await resolveInvoiceScopeContext(req)
    const { searchParams } = new URL(req.url)
    const rawThroughDate = searchParams.get('throughDate')
    const queryInput = invoiceForecastQuerySchema.parse({
      throughDate: rawThroughDate ?? undefined,
    })

    const service = context.container.resolve<InvoiceService>('invoiceService')
    const forecast = await service.getForecast(context.scope, queryInput)

    return NextResponse.json(forecast satisfies InvoiceForecastDto)
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
      query: invoiceForecastQuerySchema,
      responses: [
        { status: 200, description: 'Invoice cash-flow forecast', schema: invoiceForecastResponseSchema },
      ],
      errors: invoiceForecastRouteErrors,
    },
  },
}
