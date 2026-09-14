import { NextResponse } from 'next/server'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceSendSchema } from '../../../../data/validators'
import type { InvoiceScope } from '../../../../data/scope'
import type { InvoiceSendCommandResult } from '../../../../commands/invoices'
import { createInvoiceOperationId } from '../../../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceInvoiceRouteError,
  INVOICE_INVOICE_RESOURCE_KIND,
  invoiceSendResponseSchema,
  invoiceInvoiceParamSchema,
  invoiceInvoiceRouteErrors,
  invoiceInvoiceManageRouteMetadata,
  invoiceInvoicesTag,
  readRequestRecord,
  resolveInvoiceInvoiceRouteContext,
} from '../../shared'

export const metadata = { POST: invoiceInvoiceManageRouteMetadata }

type RouteContext = {
  params?: Promise<{ id?: string }> | { id?: string }
}

export async function POST(req: Request, routeContext: RouteContext = {}) {
  let routeScope: InvoiceScope | undefined
  let invoiceId: string | undefined
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceInvoiceParamSchema.parse(rawParams)
    invoiceId = params.id
    const context = await resolveInvoiceInvoiceRouteContext(req)
    routeScope = context.scope
    const input = invoiceSendSchema.parse(await readRequestRecord(req))
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

    const commandInput = guarded.modifiedPayload
      ? invoiceSendSchema.parse({ ...input, ...guarded.modifiedPayload })
      : input
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<{ id: string; input: typeof commandInput }, InvoiceSendCommandResult>(
      'invoice.invoices.send',
      { input: { id: params.id, input: commandInput }, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoice: result.invoice })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'send invoice', routeScope, invoiceId)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Send an AR invoice by email',
  methods: {
    POST: {
      operationId: createInvoiceOperationId('invoices', 'send'),
      summary: 'Send invoice',
      description: 'Sends a scoped AR invoice and replaces its email tracking token after delivery.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceSendSchema },
      responses: [{ status: 200, description: 'Invoice sent', schema: invoiceSendResponseSchema }],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}
