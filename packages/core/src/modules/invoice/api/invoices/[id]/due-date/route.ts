import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceDueDateUpdateSchema } from '../../../../data/validators'
import type { InvoiceScope } from '../../../../data/scope'
import type { InvoiceDueDateUpdateCommandResult } from '../../../../commands/invoices'
import { createInvoiceOperationId } from '../../../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceInvoiceRouteError,
  INVOICE_INVOICE_RESOURCE_KIND,
  invoiceInvoiceParamSchema,
  invoiceInvoiceRouteErrors,
  invoiceInvoiceManageRouteMetadata,
  invoiceInvoicesTag,
  invoiceManualMutationResponseSchema,
  readRequestRecord,
  resolveInvoiceInvoiceRouteContext,
} from '../../shared'

export const metadata = {
  PATCH: invoiceInvoiceManageRouteMetadata,
}

type RouteContext = {
  params?: Promise<{ id?: string }> | { id?: string }
}

export async function PATCH(req: Request, routeContext: RouteContext = {}) {
  let routeScope: InvoiceScope | undefined
  let invoiceId: string | undefined
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceInvoiceParamSchema.parse(rawParams)
    invoiceId = params.id
    const context = await resolveInvoiceInvoiceRouteContext(req)
    routeScope = context.scope
    const input = invoiceDueDateUpdateSchema.parse(await readRequestRecord(req))
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
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const commandInput = guarded.modifiedPayload
      ? invoiceDueDateUpdateSchema.parse({ ...input, ...guarded.modifiedPayload })
      : input
    const { result } = await commandBus.execute<{ id: string; input: typeof commandInput }, InvoiceDueDateUpdateCommandResult>(
      'invoice.invoices.update-due-date',
      { input: { id: params.id, input: commandInput }, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoice: result.invoice })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'update invoice due date', routeScope, invoiceId)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Update invoice due date',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('invoices', 'due-date.update'),
      summary: 'Update invoice due date',
      description:
        'Sets or clears the due date on a scoped invoice. Works for both MANUAL and imported invoices. ' +
        'Imported tax data is never touched. Updates nextDueDate when no installment plan exists and the invoice is unsettled. ' +
        'Uses optimistic locking.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceDueDateUpdateSchema },
      responses: [
        { status: 200, description: 'Due date updated', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}