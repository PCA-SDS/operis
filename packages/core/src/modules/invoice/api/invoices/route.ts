import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { invoiceListQuerySchema } from '../../data/validators'
import type { InvoiceScope } from '../../data/scope'
import type { InvoiceService } from '../../services/invoice-service'
import { createInvoiceOperationId } from '../openapi'
import {
  handleInvoiceInvoiceRouteError,
  invoiceInvoiceRouteErrors,
  invoiceInvoiceRouteMetadata,
  invoiceInvoicesTag,
  invoiceListResponseSchema,
  resolveInvoiceInvoiceRouteContext,
} from './shared'

export const metadata = {
  GET: invoiceInvoiceRouteMetadata,
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
  },
}
