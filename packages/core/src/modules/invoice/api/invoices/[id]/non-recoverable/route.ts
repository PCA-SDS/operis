import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceNonRecoverableUpdateSchema } from '../../../../data/validators'
import type { InvoiceScope } from '../../../../data/scope'
import type { InvoiceNonRecoverableUpdateCommandResult } from '../../../../commands/invoices'
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
    const input = invoiceNonRecoverableUpdateSchema.parse(await readRequestRecord(req))
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
      ? invoiceNonRecoverableUpdateSchema.parse({ ...input, ...guarded.modifiedPayload })
      : input
    const { result } = await commandBus.execute<
      { id: string; input: typeof commandInput },
      InvoiceNonRecoverableUpdateCommandResult
    >(
      'invoice.invoices.update-non-recoverable',
      { input: { id: params.id, input: commandInput }, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoice: result.invoice })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'update invoice non-recoverable state', routeScope, invoiceId)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Update AR invoice non-recoverable state',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('invoices', 'non-recoverable.update'),
      summary: 'Update AR invoice non-recoverable state',
      description:
        'Marks or clears the non-recoverable state on a scoped AR invoice. A reason is required when marking an invoice non-recoverable, and settled invoices are rejected. ' +
        'Uses optimistic locking and preserves the audit note and timestamp on the invoice.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceNonRecoverableUpdateSchema },
      responses: [
        { status: 200, description: 'Non-recoverable state updated', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}
