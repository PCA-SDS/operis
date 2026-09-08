import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import type { InvoiceScope } from '../../../data/scope'
import type { InvoiceService } from '../../../services/invoice-service'
import { createInvoiceOperationId } from '../../openapi'
import {
  handleInvoiceInvoiceRouteError,
  invoiceDetailResponseSchema,
  invoiceInvoiceParamSchema,
  invoiceInvoiceRouteErrors,
  invoiceInvoiceRouteMetadata,
  invoiceInvoicesTag,
  resolveInvoiceInvoiceRouteContext,
} from '../shared'

export const metadata = {
  GET: invoiceInvoiceRouteMetadata,
}

type RouteContext = {
  params?: {
    id?: string
  }
}

export async function GET(req: Request, routeContext: RouteContext = {}) {
  let routeScope: InvoiceScope | undefined
  let invoiceId: string | undefined
  try {
    const params = invoiceInvoiceParamSchema.parse({ id: routeContext.params?.id })
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
  },
}
