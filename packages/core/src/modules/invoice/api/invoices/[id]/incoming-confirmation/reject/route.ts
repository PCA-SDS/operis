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
    commandId: 'invoice.payment_confirmations.reject-incoming',
    errorLabel: 'reject incoming payment confirmation',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePaymentConfirmationsTag,
  summary: 'Reject incoming payment confirmation',
  methods: {
    POST: {
      operationId: createInvoiceOperationId('paymentConfirmations', 'incoming.reject'),
      summary: 'Reject a matching incoming payment claim',
      description: 'Rejects the matching pending whole-invoice claim without changing either invoice payment state.',
      pathParams: invoiceInvoiceParamSchema,
      responses: [
        { status: 200, description: 'Incoming payment confirmation rejected', schema: invoiceIncomingPaymentConfirmationResponseSchema },
      ],
      errors: invoicePaymentConfirmationRouteErrors,
    },
  },
}
