import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'

import { Invoice } from '../data/entities'
import { requireInvoiceScope } from '../data/scope'

export const INVOICE_INVOICE_RESOURCE_KIND = 'invoice.invoice'

/**
 * The `updated_at` floor every command that writes a single invoice must clear.
 *
 * `invoice:Invoice` is `enabled` in the record-locks ledger, so this has to run
 * on each write surface — including the ones that live outside `invoices.ts`,
 * which is why it sits here rather than staying private to that file.
 */
export async function enforceInvoiceCommandOptimisticLock(
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
    return
  }
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: INVOICE_INVOICE_RESOURCE_KIND,
    resourceId: id,
    current: current.updatedAt,
    request: ctx.request,
  })
}
