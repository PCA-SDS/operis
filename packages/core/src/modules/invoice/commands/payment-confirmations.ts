import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

import { requireInvoiceScope } from '../data/scope'
import { enforceInvoiceCommandOptimisticLock } from './shared'
import {
  invoiceIncomingPaymentConfirmationSchema,
  invoicePaymentConfirmationRequestSchema,
} from '../data/validators'
import type {
  InvoiceIncomingPaymentConfirmationResult,
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
    await enforceInvoiceCommandOptimisticLock(ctx, input.invoiceId)

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

function incomingCommand(
  target: 'accept' | 'reject',
): CommandHandler<unknown, InvoiceIncomingPaymentConfirmationResult> {
  return {
    id: `invoice.payment_confirmations.${target}-incoming`,
    isUndoable: false,
    async execute(rawInput, ctx) {
      const input = invoiceIncomingPaymentConfirmationSchema.parse(rawInput)
      const scope = requireInvoiceScope(ctx)
      await enforceInvoiceCommandOptimisticLock(ctx, input.invoiceId)

      return target === 'accept'
        ? serviceFrom(ctx).acceptIncoming(scope, input.invoiceId)
        : serviceFrom(ctx).rejectIncoming(scope, input.invoiceId)
    },
    buildLog({ result, ctx }) {
      const scope = requireInvoiceScope(ctx)

      return {
        actionLabel: `${target === 'accept' ? 'Accept' : 'Reject'} incoming invoice payment confirmation`,
        resourceKind: 'invoice.payment_confirmation',
        resourceId: result.confirmationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        context: {
          invoiceId: result.invoice.id,
          status: result.status,
        },
      }
    },
  }
}

export const acceptIncomingPaymentConfirmationCommand = incomingCommand('accept')
export const rejectIncomingPaymentConfirmationCommand = incomingCommand('reject')

registerCommand(requestPaymentConfirmationCommand)
registerCommand(acceptIncomingPaymentConfirmationCommand)
registerCommand(rejectIncomingPaymentConfirmationCommand)
