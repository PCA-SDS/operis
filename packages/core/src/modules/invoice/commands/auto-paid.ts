import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

import { requireInvoiceScope } from '../data/scope'
import { enforceInvoiceCommandOptimisticLock } from './shared'
import {
  invoiceAutoPaidReverseSchema,
  invoiceAutoPaidRuleRemoveSchema,
  invoiceAutoPaidRuleUpsertSchema,
} from '../data/validators'
import type {
  InvoiceAutoPaidApplyAllResult,
  InvoiceAutoPaidRemoveResult,
  InvoiceAutoPaidService,
} from '../services/auto-paid-service'

export type InvoiceAutoPaidAddCommandResult = {
  ruleId: string
  taxCode: string
  settledCount: number
}

export type InvoiceAutoPaidRemoveCommandResult = InvoiceAutoPaidRemoveResult

export type InvoiceAutoPaidApplyAllCommandResult = InvoiceAutoPaidApplyAllResult

export type InvoiceAutoPaidReverseCommandResult = {
  invoiceId: string
  reversed: true
}

function serviceFrom(ctx: CommandRuntimeContext): InvoiceAutoPaidService {
  return ctx.container.resolve<InvoiceAutoPaidService>('invoiceAutoPaidService')
}

export const addAutoPaidRuleCommand: CommandHandler<unknown, InvoiceAutoPaidAddCommandResult> = {
  id: 'invoice.auto_paid.add',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = invoiceAutoPaidRuleUpsertSchema.parse(rawInput)
    const scope = requireInvoiceScope(ctx)
    const result = await serviceFrom(ctx).upsertRule(scope, input)

    return {
      ruleId: result.rule.id,
      taxCode: result.rule.taxCode,
      settledCount: result.settledCount,
    }
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Add invoice auto-paid rule',
      resourceKind: 'invoice.auto_paid_tax_code',
      resourceId: result.ruleId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        taxCode: result.taxCode,
        settledCount: result.settledCount,
      },
    }
  },
}

export const removeAutoPaidRuleCommand: CommandHandler<unknown, InvoiceAutoPaidRemoveCommandResult> = {
  id: 'invoice.auto_paid.remove',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = invoiceAutoPaidRuleRemoveSchema.parse(rawInput)
    const scope = requireInvoiceScope(ctx)

    return serviceFrom(ctx).removeRule(scope, input)
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Remove invoice auto-paid rule',
      resourceKind: 'invoice.auto_paid_tax_code',
      resourceId: result.ruleId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        taxCode: result.taxCode,
        revertedCount: result.revertedCount,
      },
    }
  },
}

export const applyAllAutoPaidRulesCommand: CommandHandler<unknown, InvoiceAutoPaidApplyAllCommandResult> = {
  id: 'invoice.auto_paid.apply_all',
  isUndoable: false,
  async execute(_rawInput, ctx) {
    const scope = requireInvoiceScope(ctx)

    return serviceFrom(ctx).applyAll(scope)
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Apply invoice auto-paid rules',
      resourceKind: 'invoice.auto_paid_tax_code',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        ruleCount: result.ruleCount,
        settledCount: result.settledCount,
      },
    }
  },
}

export const reverseAutoPaidInvoiceCommand: CommandHandler<unknown, InvoiceAutoPaidReverseCommandResult> = {
  id: 'invoice.auto_paid.reverse',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = invoiceAutoPaidReverseSchema.parse(rawInput)
    const scope = requireInvoiceScope(ctx)
    await enforceInvoiceCommandOptimisticLock(ctx, input.invoiceId)
    const result = await serviceFrom(ctx).reverseInvoice(scope, input)

    return {
      invoiceId: result.invoice.id,
      reversed: true,
    }
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Reverse invoice auto-paid settlement',
      resourceKind: 'invoice.invoice',
      resourceId: result.invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(addAutoPaidRuleCommand)
registerCommand(removeAutoPaidRuleCommand)
registerCommand(applyAllAutoPaidRulesCommand)
registerCommand(reverseAutoPaidInvoiceCommand)
