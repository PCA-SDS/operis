import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

import {
  INVOICE_TRACKING_PIXEL_RATE_LIMIT_REQUESTS,
  INVOICE_TRACKING_PIXEL_RATE_LIMIT_WINDOW_SECONDS,
  invoicePublicTokenSchema,
} from '../../../../data/validators'
import { transparentInvoiceTrackingGif } from '../../../../services/invoice-email'
import type { InvoiceTrackingService } from '../../../../services/invoice-tracking-service'
import { createInvoiceOperationId, invoicePublicTag } from '../../../openapi'

const logger = createLogger('invoice').child({ component: 'tracking-api' })
const rateLimitConfig = readEndpointRateLimitConfig('INVOICE_TRACKING_PIXEL', {
  points: INVOICE_TRACKING_PIXEL_RATE_LIMIT_REQUESTS,
  duration: INVOICE_TRACKING_PIXEL_RATE_LIMIT_WINDOW_SECONDS,
  blockDuration: INVOICE_TRACKING_PIXEL_RATE_LIMIT_WINDOW_SECONDS,
  keyPrefix: 'invoice_tracking_pixel',
})
const tokenParamsSchema = z.object({ token: invoicePublicTokenSchema }).strict()
export const metadata = { GET: { requireAuth: false } }
const gifHeaders = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

type RouteContext = { params?: Promise<{ token?: string }> | { token?: string } }

function gifResponse(): NextResponse {
  const gif = transparentInvoiceTrackingGif()
  const body = new Uint8Array(gif).slice().buffer as ArrayBuffer
  return new NextResponse(body, { status: 200, headers: gifHeaders })
}

export async function GET(req: Request, routeContext: RouteContext = {}) {
  const rawParams = routeContext.params ? await routeContext.params : {}
  const parsed = tokenParamsSchema.safeParse(rawParams)
  if (!parsed.success) {
    logger.info('Invoice tracking token invalid')
    return gifResponse()
  }

  try {
    const rateLimiter = getCachedRateLimiterService()
    if (rateLimiter) {
      const key = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
      const limited = await checkRateLimit(rateLimiter, rateLimitConfig, key, RATE_LIMIT_ERROR_FALLBACK, {
        failClosed: false,
        unavailableMessage: RATE_LIMIT_ERROR_FALLBACK,
      })
      if (limited) return gifResponse()
    }

    const container = await createRequestContainer()
    const service = container.resolve<InvoiceTrackingService>('invoiceTrackingService')
    await service.recordOpen(parsed.data.token)
  } catch (err) {
    logger.error('Invoice tracking database failure', { err })
  }

  return gifResponse()
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePublicTag,
  summary: 'Track invoice email open',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('invoiceTracking', 'pixel'),
      summary: 'Return invoice tracking pixel',
      description: 'Always returns a transparent GIF and never exposes invoice data.',
      pathParams: tokenParamsSchema,
      responses: [{ status: 200, description: 'Transparent tracking GIF' }],
    },
  },
}
