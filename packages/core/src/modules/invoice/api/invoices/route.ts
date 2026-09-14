import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceListQuerySchema, invoiceManualCreateSchema } from '../../data/validators'
import type { InvoiceScope } from '../../data/scope'
import type { InvoiceService } from '../../services/invoice-service'
import type { InvoiceManualCreateCommandResult } from '../../commands/invoices'
import { createInvoiceOperationId } from '../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceInvoiceRouteError,
  INVOICE_INVOICE_RESOURCE_KIND,
  invoiceInvoiceRouteErrors,
  invoiceInvoiceManageRouteMetadata,
  invoiceInvoiceRouteMetadata,
  invoiceInvoicesTag,
  invoiceListResponseSchema,
  invoiceManualMutationResponseSchema,
  readRequestRecord,
  resolveInvoiceInvoiceRouteContext,
} from './shared'

export const metadata = {
  GET: invoiceInvoiceRouteMetadata,
  POST: invoiceInvoiceManageRouteMetadata,
}

export async function GET(req: Request) {
  let routeScope: InvoiceScope | undefined
  try {
    const context = await resolveInvoiceInvoiceRouteContext(req)
    routeScope = context.scope
    const url = new URL(req.url)
    const query = invoiceListQuerySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      direction: url.searchParams.get('direction') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      settlement: url.searchParams.get('settlement') ?? undefined,
      recoverability: url.searchParams.get('recoverability') ?? undefined,
      partnerId: url.searchParams.get('partnerId') ?? undefined,
      fromDate: url.searchParams.get('fromDate') ?? undefined,
      toDate: url.searchParams.get('toDate') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      sortField: url.searchParams.get('sortField') ?? undefined,
      sortDir: url.searchParams.get('sortDir') ?? undefined,
    })
    const service = context.container.resolve<InvoiceService>('invoiceService')
    const result = await service.listInvoices(context.scope, query)

    return NextResponse.json(result)
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'list invoices', routeScope)
  }
}

export async function POST(req: Request) {
  let routeScope: InvoiceScope | undefined
  try {
    const context = await resolveInvoiceInvoiceRouteContext(req)
    routeScope = context.scope
    const input = invoiceManualCreateSchema.parse(await readRequestRecord(req))
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
        operation: 'create',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<typeof input, InvoiceManualCreateCommandResult>(
      'invoice.invoices.create',
      {
        input: guarded.modifiedPayload ? invoiceManualCreateSchema.parse({ ...input, ...guarded.modifiedPayload }) : input,
        ctx: buildInvoiceCommandContext(context, req),
      },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoice: result.invoice }, { status: 201 })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, 'create manual invoice', routeScope)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'List invoices',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('invoices', 'list'),
      summary: 'List invoices',
      description: 'Returns scoped AP and AR invoices with safe filters, pagination, and stable sorting.',
      query: invoiceListQuerySchema,
      responses: [
        { status: 200, description: 'Invoice list', schema: invoiceListResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
    POST: {
      operationId: createInvoiceOperationId('invoices', 'create'),
      summary: 'Create manual invoice',
      description: 'Creates a scoped manual AP invoice with server-calculated totals and initial payment state.',
      requestBody: { contentType: 'application/json', schema: invoiceManualCreateSchema },
      responses: [
        { status: 201, description: 'Manual invoice created', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}
