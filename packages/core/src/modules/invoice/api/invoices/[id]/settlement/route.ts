import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceSettlementUpdateSchema } from '../../../../data/validators'
import type { InvoiceScope } from '../../../../data/scope'
import type { InvoiceSettlementUpdateCommandResult } from '../../../../commands/invoices'
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
    const input = invoiceSettlementUpdateSchema.parse(await readRequestRecord(req))
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
      ? invoiceSettlementUpdateSchema.parse({ ...input, ...guarded.modifiedPayload })
      : input
    const { result } = await commandBus.execute<{ id: string; input: typeof commandInput }, InvoiceSettlementUpdateCommandResult>(
      'invoice.invoices.update-settlement',
      { input: { id: params.id, input: commandInput }, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoice: result.invoice })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'update invoice settlement', routeScope, invoiceId)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Update AR invoice settlement',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('invoices', 'settlement.update'),
      summary: 'Update AR invoice settlement',
      description:
        'Settles or unsets settlement on a scoped AR invoice. AP direct settlement is rejected. ' +
        'Installment rows are updated when present, invoice payment rollups are recomputed, and settling clears non-recoverable state. ' +
        'Uses optimistic locking.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceSettlementUpdateSchema },
      responses: [
        { status: 200, description: 'Settlement updated', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}
