import { z } from 'zod'
import { currencyCodeSchema, moneyAmountSchema } from '@open-mercato/shared/lib/validation'

const unifiedPaymentStatusSchema = z.enum([
  'pending',
  'authorized',
  'captured',
  'partially_captured',
  'refunded',
  'partially_refunded',
  'cancelled',
  'failed',
  'expired',
  'unknown',
])

export const createSessionSchema = z.object({
  providerKey: z.string().min(1),
  paymentMethodId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  // Bounded and capped at minor-unit precision. The gateway adapters convert with
  // `Math.round(amount * 100)`, so the previous unbounded `z.number().positive()`
  // let `0.001` create a session that charges **zero** and `10.005` one that
  // charges `10.01`, with nothing surfaced to the caller. The column is
  // numeric(18,4), but 2dp is what can actually be charged.
  // `coerce: false` keeps the original `z.number()` strictness: this is a JSON
  // body, and coercion would turn `true` into a 1.00 session.
  // `max` is the `numeric(18,4)` column's capacity: the field was previously
  // unbounded, and the shared 999,999,999 default would reject amounts that
  // high-denomination currencies reach legitimately.
  amount: moneyAmountSchema({ positive: true, scale: 2, coerce: false, max: 99_999_999_999_999 }),
  // Trimmed and upper-cased, which is the form the gateway adapters treat as
  // canonical (they lower-case on the way out to Stripe and upper-case what comes
  // back) and the form `PaymentGatewayService` already normalizes to before
  // comparing against the order currency. Previously `.min(3).max(3)`, which
  // accepted any three characters — "ab1" and "$$$" reached the transaction row
  // and the provider — while rejecting the padded " eur " the service supports.
  currencyCode: currencyCodeSchema(),
  captureMethod: z.enum(['automatic', 'manual']).default('automatic'),
  description: z.string().max(500).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  presentation: z.object({
    mode: z.enum(['auto', 'embedded', 'redirect']).optional(),
    rendererKey: z.string().min(1).optional(),
    rendererSettings: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
})

export type CreateSessionPayload = z.infer<typeof createSessionSchema>

export const captureSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(),
  operationId: z.string().trim().min(1).max(200).optional(),
})

export type CapturePayload = z.infer<typeof captureSchema>

export const refundSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(),
  reason: z.string().max(200).optional(),
  operationId: z.string().trim().min(1).max(200).optional(),
})

export type RefundPayload = z.infer<typeof refundSchema>

export const cancelSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().max(200).optional(),
  operationId: z.string().trim().min(1).max(200).optional(),
})

export type CancelPayload = z.infer<typeof cancelSchema>

export const getStatusSchema = z.object({
  transactionId: z.string().uuid(),
})

export type GetStatusPayload = z.infer<typeof getStatusSchema>

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  providerKey: z.string().trim().min(1).max(100).optional(),
  status: unifiedPaymentStatusSchema.optional(),
})

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>
