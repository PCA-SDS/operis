import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_ERROR_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import {
  INVOICE_PAYMENT_CONFIRMATION_PUBLIC_RATE_LIMIT_REQUESTS,
  INVOICE_PAYMENT_CONFIRMATION_PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
  invoicePublicTokenSchema,
} from '../../../../data/validators'
import type { InvoicePaymentConfirmationsService } from '../../../../services/payment-confirmations-service'
import type { InvoicePublicToken } from '../../../../data/validators'

const logger = createLogger('invoice').child({ component: 'payment-confirmations-public-api' })
const rateLimitConfig = readEndpointRateLimitConfig('INVOICE_PAYMENT_CONFIRMATION_PUBLIC', {
  points: INVOICE_PAYMENT_CONFIRMATION_PUBLIC_RATE_LIMIT_REQUESTS,
  duration: INVOICE_PAYMENT_CONFIRMATION_PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
  blockDuration: INVOICE_PAYMENT_CONFIRMATION_PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
  keyPrefix: 'invoice_payment_confirmation_public',
})

export type RouteContext = { params?: Promise<{ token?: string }> | { token?: string } }
export const tokenParamsSchema = z.object({ token: invoicePublicTokenSchema }).strict()

type PreparedRequest =
  | { token: InvoicePublicToken; service: InvoicePaymentConfirmationsService }
  | { token: null; response: NextResponse }

export async function preparePublicRequest(req: Request, routeContext: RouteContext): Promise<PreparedRequest> {
  const params = routeContext.params ? await routeContext.params : {}
  const token = invoicePublicTokenSchema.safeParse(params.token)
  if (!token.success) return { token: null, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  const rateLimiter = getCachedRateLimiterService()
  if (rateLimiter) {
    const clientIp = getClientIp(req, rateLimiter.trustProxyDepth) ?? RATE_LIMIT_FALLBACK_KEY
    const limited = await checkRateLimit(rateLimiter, rateLimitConfig, clientIp, RATE_LIMIT_ERROR_FALLBACK)
    if (limited) return { token: null, response: limited }
  } else {
    logger.error('Rate limiter service is not registered for public payment confirmations')
  }

  const container = await createRequestContainer()
  return {
    token: token.data,
    service: container.resolve<InvoicePaymentConfirmationsService>('invoicePaymentConfirmationsService'),
  }
}

export { logger }
