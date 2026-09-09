import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'

import { Invoice } from '../data/entities'
import { requireInvoiceScope } from '../data/scope'
import {
  invoiceIdSchema,
  invoiceManualCreateSchema,
  invoiceManualUpdateSchema,
  invoiceDueDateUpdateSchema,
  invoiceSettlementUpdateSchema,
  invoiceNonRecoverableUpdateSchema,
} from '../data/validators'
import type {
  InvoiceManualDeleteResult,
  InvoiceManualMutationResult,
  InvoiceDueDateUpdateResult,
  InvoiceNonRecoverableUpdateResult,
  InvoiceSettlementUpdateResult,
  InvoiceService,
} from '../services/invoice-service'

const INVOICE_INVOICE_RESOURCE_KIND = 'invoice.invoice'

export type InvoiceManualCreateCommandResult = {
  invoiceId: string
  invoice: InvoiceManualMutationResult['invoice']
}

export type InvoiceManualUpdateCommandResult = InvoiceManualCreateCommandResult
export type InvoiceManualDeleteCommandResult = InvoiceManualDeleteResult

function serviceFrom(ctx: CommandRuntimeContext): InvoiceService {
  return ctx.container.resolve<InvoiceService>('invoiceService')
}

export const createManualInvoiceCommand: CommandHandler<unknown, InvoiceManualCreateCommandResult> = {
  id: 'invoice.invoices.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = invoiceManualCreateSchema.parse(rawInput)
    const scope = requireInvoiceScope(ctx)
    const result = await serviceFrom(ctx).createManualInvoice(scope, input)

    return {
      invoiceId: result.invoice.id,
      invoice: result.invoice,
    }
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Create manual invoice',
      resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
      resourceId: result.invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        direction: result.invoice.direction,
        invoiceNumber: result.invoice.invoiceNumber,
        autoSettled: result.invoice.autoSettled,
      },
    }
  },
}

export const updateManualInvoiceCommand: CommandHandler<unknown, InvoiceManualUpdateCommandResult> = {
  id: 'invoice.invoices.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const record = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {}
    const id = invoiceIdSchema.parse(record.id)
    const input = invoiceManualUpdateSchema.parse(record.input ?? record)
    const scope = requireInvoiceScope(ctx)
    const em = ctx.container.resolve('em') as { findOne: (entity: typeof Invoice, where: Record<string, unknown>) => Promise<Invoice | null> }
    const current = await em.findOne(Invoice, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!current) {
      enforceRecordGoneIsConflict({ resourceKind: INVOICE_INVOICE_RESOURCE_KIND, resourceId: id, request: ctx.request })
    } else {
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
        resourceId: id,
        current: current.updatedAt,
        request: ctx.request,
      })
    }
    const result = await serviceFrom(ctx).updateManualInvoice(scope, id, input)

    return {
      invoiceId: result.invoice.id,
      invoice: result.invoice,
    }
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Update manual invoice',
      resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
      resourceId: result.invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        direction: result.invoice.direction,
        invoiceNumber: result.invoice.invoiceNumber,
        autoSettled: result.invoice.autoSettled,
      },
    }
  },
}

export const deleteManualInvoiceCommand: CommandHandler<unknown, InvoiceManualDeleteCommandResult> = {
  id: 'invoice.invoices.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const record = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {}
    const id = invoiceIdSchema.parse(record.id)
    const scope = requireInvoiceScope(ctx)
    const em = ctx.container.resolve('em') as { findOne: (entity: typeof Invoice, where: Record<string, unknown>) => Promise<Invoice | null> }
    const current = await em.findOne(Invoice, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!current) {
      enforceRecordGoneIsConflict({ resourceKind: INVOICE_INVOICE_RESOURCE_KIND, resourceId: id, request: ctx.request })
    } else {
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
        resourceId: id,
        current: current.updatedAt,
        request: ctx.request,
      })
    }

    return serviceFrom(ctx).deleteManualInvoice(scope, id)
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Delete manual invoice',
      resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
      resourceId: result.invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(createManualInvoiceCommand)
registerCommand(updateManualInvoiceCommand)
registerCommand(deleteManualInvoiceCommand)

export type InvoiceDueDateUpdateCommandResult = {
  invoiceId: string
  invoice: InvoiceDueDateUpdateResult['invoice']
}
export type InvoiceSettlementUpdateCommandResult = {
  invoiceId: string
  invoice: InvoiceSettlementUpdateResult['invoice']
}
export type InvoiceNonRecoverableUpdateCommandResult = {
  invoiceId: string
  invoice: InvoiceNonRecoverableUpdateResult['invoice']
}

async function enforceInvoiceCommandOptimisticLock(
  ctx: CommandRuntimeContext,
  id: string,
): Promise<void> {
  const scope = requireInvoiceScope(ctx)
  const em = ctx.container.resolve('em') as { findOne: (entity: typeof Invoice, where: Record<string, unknown>) => Promise<Invoice | null> }
  const current = await em.findOne(Invoice, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!current) {
    enforceRecordGoneIsConflict({ resourceKind: INVOICE_INVOICE_RESOURCE_KIND, resourceId: id, request: ctx.request })
  } else {
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
      resourceId: id,
      current: current.updatedAt,
      request: ctx.request,
    })
  }
}

export const updateInvoiceDueDateCommand: CommandHandler<unknown, InvoiceDueDateUpdateCommandResult> = {
  id: 'invoice.invoices.update-due-date',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const record = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {}
    const id = invoiceIdSchema.parse(record.id)
    const input = invoiceDueDateUpdateSchema.parse(record.input ?? record)
    const scope = requireInvoiceScope(ctx)
    await enforceInvoiceCommandOptimisticLock(ctx, id)
    const result = await serviceFrom(ctx).updateDueDate(scope, id, input)

    return {
      invoiceId: result.invoice.id,
      invoice: result.invoice,
    }
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Update invoice due date',
      resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
      resourceId: result.invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        dueDate: result.invoice.dueDate ?? null,
        cleared: result.invoice.dueDate == null,
      },
    }
  },
}

registerCommand(updateInvoiceDueDateCommand)

export const updateInvoiceSettlementCommand: CommandHandler<unknown, InvoiceSettlementUpdateCommandResult> = {
  id: 'invoice.invoices.update-settlement',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const record = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {}
    const id = invoiceIdSchema.parse(record.id)
    const input = invoiceSettlementUpdateSchema.parse(record.input ?? record)
    const scope = requireInvoiceScope(ctx)
    await enforceInvoiceCommandOptimisticLock(ctx, id)
    const result = await serviceFrom(ctx).updateReceivableSettlement(scope, id, input)

    return {
      invoiceId: result.invoice.id,
      invoice: result.invoice,
    }
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Update invoice settlement',
      resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
      resourceId: result.invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        direction: result.invoice.direction,
        settlementStatus: result.invoice.settlementStatus,
        paidAmount: result.invoice.paidAmount,
        outstandingAmount: result.invoice.outstandingAmount,
      },
    }
  },
}

export const updateInvoiceNonRecoverableCommand: CommandHandler<unknown, InvoiceNonRecoverableUpdateCommandResult> = {
  id: 'invoice.invoices.update-non-recoverable',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const record = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {}
    const id = invoiceIdSchema.parse(record.id)
    const input = invoiceNonRecoverableUpdateSchema.parse(record.input ?? record)
    const scope = requireInvoiceScope(ctx)
    await enforceInvoiceCommandOptimisticLock(ctx, id)
    const result = await serviceFrom(ctx).updateNonRecoverable(scope, id, input)

    return {
      invoiceId: result.invoice.id,
      invoice: result.invoice,
    }
  },
  buildLog({ result, ctx }) {
    const scope = requireInvoiceScope(ctx)

    return {
      actionLabel: 'Update invoice non-recoverable state',
      resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
      resourceId: result.invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        direction: result.invoice.direction,
        nonRecoverable: result.invoice.nonRecoverable,
      },
    }
  },
}

registerCommand(updateInvoiceSettlementCommand)
registerCommand(updateInvoiceNonRecoverableCommand)
