import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

import { requireInvoiceScope } from '../data/scope'
import { invoicePaymentConfirmationRequestSchema } from '../data/validators'
import type {
  InvoicePaymentConfirmationRequestResult,
  InvoicePaymentConfirmationsService,
} from '../services/payment-confirmations-service'

function serviceFrom(ctx: CommandRuntimeContext): InvoicePaymentConfirmationsService {
  return ctx.container.resolve<InvoicePaymentConfirmationsService>('invoicePaymentConfirmationsService')
}

export const requestPaymentConfirmationCommand: CommandHandler<unknown, InvoicePaymentConfirmationRequestResult> = {
  id: 'invoice.payment_confirmations.request',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = invoicePaymentConfirmationRequestSchema.parse(rawInput)
    const scope = requireInvoiceScope(ctx)

    return serviceFrom(ctx).request(scope, input)
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Request invoice payment confirmation',
      resourceKind: 'invoice.payment_confirmation',
      resourceId: result.confirmationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        invoiceId: result.invoiceId,
        installmentId: result.installmentId,
        expiresAt: result.expiresAt,
      },
    }
  },
}

registerCommand(requestPaymentConfirmationCommand)
