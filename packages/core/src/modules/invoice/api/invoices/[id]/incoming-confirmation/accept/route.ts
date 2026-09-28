import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { createInvoiceOperationId, invoicePaymentConfirmationsTag } from '../../../../openapi'
import { invoiceInvoiceParamSchema } from '../../../shared'
import { decideIncomingPaymentConfirmation, type IncomingConfirmationRouteContext } from '../decision'
import {
  invoiceIncomingPaymentConfirmationResponseSchema,
  invoicePaymentConfirmationRouteErrors,
  invoicePaymentConfirmationRouteMetadata,
} from '../../../../payment-confirmations/shared'

export const metadata = { POST: invoicePaymentConfirmationRouteMetadata }

export async function POST(req: Request, routeContext: IncomingConfirmationRouteContext = {}) {
  return decideIncomingPaymentConfirmation(req, routeContext, {
    commandId: 'invoice.payment_confirmations.accept-incoming',
    errorLabel: 'accept incoming payment confirmation',
  })
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
