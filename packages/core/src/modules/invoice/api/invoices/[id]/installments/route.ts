import { NextResponse } from 'next/server'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { invoiceIdSchema, invoiceInstallmentPlanUpdateSchema } from '../../../../data/validators'
import { createInvoiceOperationId } from '../../../openapi'
import type { InvoiceScope } from '../../../../data/scope'
import type { InvoiceInstallmentPlanCommandResult } from '../../../../commands/invoices'
import { buildInvoiceCommandContext, handleInvoiceInvoiceRouteError, INVOICE_INVOICE_RESOURCE_KIND, invoiceInvoiceRouteErrors, invoiceInvoiceManageRouteMetadata, invoiceManualMutationResponseSchema, invoiceInvoicesTag, readRequestRecord, resolveInvoiceInvoiceRouteContext } from '../../shared'
export const metadata = { PUT: invoiceInvoiceManageRouteMetadata, DELETE: invoiceInvoiceManageRouteMetadata }
type RouteContext = { params?: Promise<{ id?: string }> | { id?: string } }
async function contextFor(req: Request, routeContext: RouteContext) {
  const rawParams = routeContext.params ? await routeContext.params : {}
  const context = await resolveInvoiceInvoiceRouteContext(req)
  return { context, id: invoiceIdSchema.parse(rawParams.id) }
}
export async function PUT(req: Request, routeContext: RouteContext = {}) {
  let scope: InvoiceScope | undefined
  try {
    const { context, id } = await contextFor(req, routeContext); scope = context.scope
    const input = invoiceInstallmentPlanUpdateSchema.parse(await readRequestRecord(req))
    const guarded = await runRouteMutationGuards({ container: context.container, req, auth: { userId: context.userId, tenantId: scope.tenantId, organizationId: scope.organizationId }, input: { resourceKind: INVOICE_INVOICE_RESOURCE_KIND, resourceId: id, operation: 'update', mutationPayload: input } })
    if (!guarded.ok) return guarded.response
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const result = await commandBus.execute<{ id: string; input: typeof input }, InvoiceInstallmentPlanCommandResult>('invoice.invoices.update-installment-plan', { input: { id, input }, ctx: buildInvoiceCommandContext(context, req) })
    await guarded.runAfterSuccess(); return NextResponse.json({ ok: true, invoice: result.result.invoice })
  } catch (error) { return handleInvoiceInvoiceRouteError(error, 'update installment plan', scope) }
}
export async function DELETE(req: Request, routeContext: RouteContext = {}) {
  let scope: InvoiceScope | undefined
  try {
    const { context, id } = await contextFor(req, routeContext); scope = context.scope
    const guarded = await runRouteMutationGuards({ container: context.container, req, auth: { userId: context.userId, tenantId: scope.tenantId, organizationId: scope.organizationId }, input: { resourceKind: INVOICE_INVOICE_RESOURCE_KIND, resourceId: id, operation: 'update', mutationPayload: { id } } })
    if (!guarded.ok) return guarded.response
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const result = await commandBus.execute<{ id: string }, InvoiceInstallmentPlanCommandResult>('invoice.invoices.delete-installment-plan', { input: { id }, ctx: buildInvoiceCommandContext(context, req) })
    await guarded.runAfterSuccess(); return NextResponse.json({ ok: true, invoice: result.result.invoice })
  } catch (error) { return handleInvoiceInvoiceRouteError(error, 'delete installment plan', scope) }
}
export const openApi = { tag: invoiceInvoicesTag, summary: 'Manage invoice installments', methods: { PUT: { operationId: createInvoiceOperationId('installments', 'plan.update'), summary: 'Update installment plan', requestBody: { contentType: 'application/json', schema: invoiceInstallmentPlanUpdateSchema }, responses: [{ status: 200, description: 'Updated', schema: invoiceManualMutationResponseSchema }], errors: invoiceInvoiceRouteErrors }, DELETE: { operationId: createInvoiceOperationId('installments', 'plan.delete'), summary: 'Delete installment plan', responses: [{ status: 200, description: 'Deleted', schema: invoiceManualMutationResponseSchema }], errors: invoiceInvoiceRouteErrors } } }
