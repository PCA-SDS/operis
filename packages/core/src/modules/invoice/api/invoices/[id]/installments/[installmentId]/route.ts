import { NextResponse } from 'next/server'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { invoiceIdSchema, invoiceInstallmentStatusUpdateSchema } from '../../../../../data/validators'
import { createInvoiceOperationId } from '../../../../openapi'
import type { InvoiceScope } from '../../../../../data/scope'
import type { InvoiceInstallmentStatusCommandResult } from '../../../../../commands/invoices'
import { buildInvoiceCommandContext, handleInvoiceInvoiceRouteError, INVOICE_INVOICE_RESOURCE_KIND, invoiceInvoiceRouteErrors, invoiceInvoiceManageRouteMetadata, invoiceManualMutationResponseSchema, invoiceInvoicesTag, readRequestRecord, resolveInvoiceInvoiceRouteContext } from '../../../shared'
export const metadata = { PATCH: invoiceInvoiceManageRouteMetadata }
type RouteContext = { params?: Promise<{ id?: string; installmentId?: string }> | { id?: string; installmentId?: string } }
export async function PATCH(req: Request, routeContext: RouteContext = {}) {
  let scope: InvoiceScope | undefined
  try {
    const raw = routeContext.params ? await routeContext.params : {}; const id = invoiceIdSchema.parse(raw.id); const installmentId = invoiceIdSchema.parse(raw.installmentId)
    const context = await resolveInvoiceInvoiceRouteContext(req); scope = context.scope
    const input = invoiceInstallmentStatusUpdateSchema.parse(await readRequestRecord(req))
    const guarded = await runRouteMutationGuards({ container: context.container, req, auth: { userId: context.userId, tenantId: scope.tenantId, organizationId: scope.organizationId }, input: { resourceKind: INVOICE_INVOICE_RESOURCE_KIND, resourceId: id, operation: 'update', mutationPayload: input } })
    if (!guarded.ok) return guarded.response
    const commandBus = context.container.resolve<CommandBus>('commandBus'); const result = await commandBus.execute<{ id: string; installmentId: string; input: typeof input }, InvoiceInstallmentStatusCommandResult>('invoice.invoices.update-installment-status', { input: { id, installmentId, input }, ctx: buildInvoiceCommandContext(context, req) })
    await guarded.runAfterSuccess(); return NextResponse.json({ ok: true, invoice: result.result.invoice })
  } catch (error) { return handleInvoiceInvoiceRouteError(error, 'update installment status', scope) }
}
export const openApi = { tag: invoiceInvoicesTag, summary: 'Update installment status', methods: { PATCH: { operationId: createInvoiceOperationId('installments', 'status.update'), summary: 'Update installment status', requestBody: { contentType: 'application/json', schema: invoiceInstallmentStatusUpdateSchema }, responses: [{ status: 200, description: 'Updated', schema: invoiceManualMutationResponseSchema }], errors: invoiceInvoiceRouteErrors } } }
