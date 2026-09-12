import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import type { InvoiceAutoPaidService } from '../../../services/auto-paid-service'
import { createInvoiceOperationId } from '../../openapi'
import {
  handleInvoiceAutoPaidRouteError,
  invoiceAutoPaidCandidatesResponseSchema,
  invoiceAutoPaidRouteErrors,
  invoiceAutoPaidRouteMetadata,
  invoiceAutoPaidTag,
  resolveInvoiceAutoPaidRouteContext,
} from '../shared'

export const metadata = {
  GET: invoiceAutoPaidRouteMetadata,
}

export async function GET(req: Request) {
  try {
    const context = await resolveInvoiceAutoPaidRouteContext(req)
    const service = context.container.resolve<InvoiceAutoPaidService>('invoiceAutoPaidService')
    const candidates = await service.listCandidates(context.scope)

    return NextResponse.json({ items: candidates })
  } catch (err) {
    return handleInvoiceAutoPaidRouteError(err, 'list auto-paid candidates')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceAutoPaidTag,
  summary: 'List auto-paid candidates',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('autoPaid', 'candidates'),
      summary: 'List auto-paid candidates',
      description: 'Returns AP supplier tax codes eligible for auto-paid rules with invoice counts.',
      responses: [
        { status: 200, description: 'Auto-paid candidates list', schema: invoiceAutoPaidCandidatesResponseSchema },
      ],
      errors: invoiceAutoPaidRouteErrors,
    },
  },
}

