import { z } from 'zod'

import { invoicePaymentConfirmationStatusSchema } from '../../data/validators'
import {
  invoiceDetailResponseSchema,
  invoiceInvoiceRouteErrors,
} from '../invoices/shared'
import { invoiceErrorSchema } from '../openapi'

export const invoicePaymentConfirmationRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.payment_confirmations.manage'],
} as const

export const INVOICE_PAYMENT_CONFIRMATION_RESOURCE_KIND = 'invoice.payment_confirmation'

export const invoicePaymentConfirmationRequestResponseSchema = z.object({
  ok: z.literal(true),
  confirmationId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  installmentId: z.string().uuid().nullable(),
  status: z.literal('PENDING'),
  expiresAt: z.string().datetime(),
}).strict()

export const invoiceIncomingPaymentConfirmationResponseSchema = z.object({
  ok: z.literal(true),
  confirmationId: z.string().uuid(),
  status: invoicePaymentConfirmationStatusSchema,
  invoice: invoiceDetailResponseSchema,
}).strict()

export const invoicePaymentConfirmationRouteErrors = [
  ...invoiceInvoiceRouteErrors,
  { status: 500, description: 'Payment confirmation processing failed', schema: invoiceErrorSchema },
]
