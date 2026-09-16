import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceIncomingPaymentConfirmationSchema } from '../../../../../data/validators'
import type { InvoiceIncomingPaymentConfirmationResult } from '../../../../../services/payment-confirmations-service'
import { createInvoiceOperationId, invoicePaymentConfirmationsTag } from '../../../../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceInvoiceRouteError,
  INVOICE_INVOICE_RESOURCE_KIND,
  invoiceInvoiceParamSchema,
  resolveInvoiceInvoiceRouteContext,
} from '../../../shared'
import {
  invoiceIncomingPaymentConfirmationResponseSchema,
  invoicePaymentConfirmationRouteErrors,
  invoicePaymentConfirmationRouteMetadata,
} from '../../../../payment-confirmations/shared'

export const metadata = { POST: invoicePaymentConfirmationRouteMetadata }

type RouteContext = { params?: Promise<{ id?: string }> | { id?: string } }

export async function POST(req: Request, routeContext: RouteContext = {}) {
  try {
    const params = invoiceInvoiceParamSchema.parse(routeContext.params ? await routeContext.params : {})
    const context = await resolveInvoiceInvoiceRouteContext(req)
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.userId,
        tenantId: context.scope.tenantId,
        organizationId: context.scope.organizationId,
      },
      input: {
        resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
        resourceId: params.id,
        operation: 'update',
        mutationPayload: { invoiceId: params.id },
      },
    })
    if (!guarded.ok) return guarded.response

    const commandInput = guarded.modifiedPayload
      ? invoiceIncomingPaymentConfirmationSchema.parse({ ...guarded.modifiedPayload, invoiceId: params.id })
      : { invoiceId: params.id }
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<unknown, InvoiceIncomingPaymentConfirmationResult>(
      'invoice.payment_confirmations.accept-incoming',
      { input: commandInput, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json(invoiceIncomingPaymentConfirmationResponseSchema.parse({ ok: true, ...result }))
  } catch (error) {
    return handleInvoiceInvoiceRouteError(error, 'accept incoming payment confirmation')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePaymentConfirmationsTag,
  summary: 'Accept incoming payment confirmation',
  methods: {
    POST: {
      operationId: createInvoiceOperationId('paymentConfirmations', 'incoming.accept'),
      summary: 'Accept a matching incoming payment claim',
      description: 'Atomically confirms the matching whole-invoice claim and settles its payer AP and receiver AR invoices.',
      pathParams: invoiceInvoiceParamSchema,
      responses: [
        { status: 200, description: 'Incoming payment confirmation accepted', schema: invoiceIncomingPaymentConfirmationResponseSchema },
      ],
      errors: invoicePaymentConfirmationRouteErrors,
    },
  },
}
