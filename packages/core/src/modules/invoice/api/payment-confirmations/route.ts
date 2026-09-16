import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoicePaymentConfirmationRequestSchema } from '../../data/validators'
import type { InvoicePaymentConfirmationRequestResult } from '../../services/payment-confirmations-service'
import { createInvoiceOperationId, invoicePaymentConfirmationsTag } from '../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceInvoiceRouteError,
  readRequestRecord,
  resolveInvoiceInvoiceRouteContext,
} from '../invoices/shared'
import {
  INVOICE_PAYMENT_CONFIRMATION_RESOURCE_KIND,
  invoicePaymentConfirmationRequestResponseSchema,
  invoicePaymentConfirmationRouteErrors,
  invoicePaymentConfirmationRouteMetadata,
} from './shared'

export const metadata = { POST: invoicePaymentConfirmationRouteMetadata }

export async function POST(req: Request) {
  try {
    const context = await resolveInvoiceInvoiceRouteContext(req)
    const input = invoicePaymentConfirmationRequestSchema.parse(await readRequestRecord(req))
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.userId,
        tenantId: context.scope.tenantId,
        organizationId: context.scope.organizationId,
      },
      input: {
        resourceKind: INVOICE_PAYMENT_CONFIRMATION_RESOURCE_KIND,
        operation: 'create',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandInput = guarded.modifiedPayload
      ? invoicePaymentConfirmationRequestSchema.parse({ ...input, ...guarded.modifiedPayload })
      : input
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<unknown, InvoicePaymentConfirmationRequestResult>(
      'invoice.payment_confirmations.request',
      { input: commandInput, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json(invoicePaymentConfirmationRequestResponseSchema.parse({ ok: true, ...result }))
  } catch (error) {
    return handleInvoiceInvoiceRouteError(error, 'request payment confirmation')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePaymentConfirmationsTag,
  summary: 'Request invoice payment confirmation',
  methods: {
    POST: {
      operationId: createInvoiceOperationId('paymentConfirmations', 'request'),
      summary: 'Request payment confirmation for an AP invoice',
      description: 'Creates and emails a whole-invoice or installment payment confirmation request.',
      requestBody: { contentType: 'application/json', schema: invoicePaymentConfirmationRequestSchema },
      responses: [
        { status: 200, description: 'Payment confirmation requested', schema: invoicePaymentConfirmationRequestResponseSchema },
      ],
      errors: invoicePaymentConfirmationRouteErrors,
    },
  },
}
