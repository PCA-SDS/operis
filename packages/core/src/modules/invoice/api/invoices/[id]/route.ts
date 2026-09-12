import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceManualUpdateSchema } from '../../../data/validators'
import type { InvoiceScope } from '../../../data/scope'
import type { InvoiceService } from '../../../services/invoice-service'
import type {
  InvoiceManualDeleteCommandResult,
  InvoiceManualUpdateCommandResult,
} from '../../../commands/invoices'
import { createInvoiceOperationId } from '../../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceInvoiceRouteError,
  INVOICE_INVOICE_RESOURCE_KIND,
  invoiceDetailResponseSchema,
  invoiceInvoiceParamSchema,
  invoiceInvoiceRouteErrors,
  invoiceInvoiceDeleteRouteMetadata,
  invoiceInvoiceManageRouteMetadata,
  invoiceInvoiceRouteMetadata,
  invoiceInvoicesTag,
  invoiceManualDeleteResponseSchema,
  invoiceManualMutationResponseSchema,
  readRequestRecord,
  resolveInvoiceInvoiceRouteContext,
} from '../shared'

export const metadata = {
  GET: invoiceInvoiceRouteMetadata,
  PUT: invoiceInvoiceManageRouteMetadata,
  DELETE: invoiceInvoiceDeleteRouteMetadata,
}

type RouteContext = {
  params?: Promise<{ id?: string }> | { id?: string }
}

export async function GET(req: Request, routeContext: RouteContext = {}) {
  let routeScope: InvoiceScope | undefined
  let invoiceId: string | undefined
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceInvoiceParamSchema.parse(rawParams)
    invoiceId = params.id
    const context = await resolveInvoiceInvoiceRouteContext(req)
    routeScope = context.scope
    const service = context.container.resolve<InvoiceService>('invoiceService')
    const invoice = await service.getInvoiceDetail(context.scope, params.id)

    return NextResponse.json(invoice)
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'get invoice detail', routeScope, invoiceId)
  }
}

export async function PUT(req: Request, routeContext: RouteContext = {}) {
  let routeScope: InvoiceScope | undefined
  let invoiceId: string | undefined
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceInvoiceParamSchema.parse(rawParams)
    invoiceId = params.id
    const context = await resolveInvoiceInvoiceRouteContext(req)
    routeScope = context.scope
    const input = invoiceManualUpdateSchema.parse(await readRequestRecord(req))
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
      ? invoiceManualUpdateSchema.parse({ ...input, ...guarded.modifiedPayload })
      : input
    const { result } = await commandBus.execute<{ id: string; input: typeof commandInput }, InvoiceManualUpdateCommandResult>(
      'invoice.invoices.update',
      { input: { id: params.id, input: commandInput }, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoice: result.invoice })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'update manual invoice', routeScope, invoiceId)
  }
}

export async function DELETE(req: Request, routeContext: RouteContext = {}) {
  let routeScope: InvoiceScope | undefined
  let invoiceId: string | undefined
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceInvoiceParamSchema.parse(rawParams)
    invoiceId = params.id
    const context = await resolveInvoiceInvoiceRouteContext(req)
    routeScope = context.scope
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
        operation: 'delete',
        mutationPayload: { id: params.id },
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<{ id: string }, InvoiceManualDeleteCommandResult>(
      'invoice.invoices.delete',
      { input: { id: params.id }, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoiceId: result.invoiceId, deleted: true })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'delete manual invoice', routeScope, invoiceId)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Get invoice detail',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('invoices', 'detail'),
      summary: 'Get invoice detail',
      description: 'Returns one scoped invoice with line items and installments ordered for display.',
      pathParams: invoiceInvoiceParamSchema,
      responses: [
        { status: 200, description: 'Invoice detail', schema: invoiceDetailResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
    PUT: {
      operationId: createInvoiceOperationId('invoices', 'update'),
      summary: 'Update manual invoice',
      description: 'Updates a scoped manual AP invoice with server-calculated totals and optimistic locking.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceManualUpdateSchema },
      responses: [
        { status: 200, description: 'Manual invoice updated', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
    DELETE: {
      operationId: createInvoiceOperationId('invoices', 'delete'),
      summary: 'Delete manual invoice',
      description: 'Soft-deletes a scoped manual AP invoice with optimistic locking.',
      pathParams: invoiceInvoiceParamSchema,
      responses: [
        { status: 200, description: 'Manual invoice deleted', schema: invoiceManualDeleteResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}
