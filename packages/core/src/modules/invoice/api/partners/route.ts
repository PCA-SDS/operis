import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { invoicePartnerListQuerySchema } from '../../data/validators'
import type { InvoicePartnerTermsService } from '../../services/partner-terms-service'
import { createInvoiceOperationId } from '../openapi'
import {
  handleInvoicePartnerRouteError,
  invoicePartnerListResponseSchema,
  invoicePartnerRouteErrors,
  invoicePartnerRouteMetadata,
  invoicePartnersTag,
  toInvoicePartnerDto,
  resolveInvoicePartnerRouteContext,
} from './shared'

export const metadata = {
  GET: invoicePartnerRouteMetadata,
}

export async function GET(req: Request) {
  try {
    const context = await resolveInvoicePartnerRouteContext(req)
    const url = new URL(req.url)
    const query = invoicePartnerListQuerySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    })
    const service = context.container.resolve<InvoicePartnerTermsService>('invoicePartnerTermsService')
    const result = await service.listPartnersPage(context.scope, query)

    return NextResponse.json({
      ...result,
      items: result.items.map(toInvoicePartnerDto),
    })
  } catch (err) {
    return handleInvoicePartnerRouteError(err, 'list partners')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePartnersTag,
  summary: 'List invoice partners',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('partners', 'list'),
      summary: 'List invoice partners',
      description: 'Returns scoped invoice partners and their default payment terms.',
      query: invoicePartnerListQuerySchema,
      responses: [
        { status: 200, description: 'Partner list', schema: invoicePartnerListResponseSchema },
      ],
      errors: invoicePartnerRouteErrors,
    },
  },
}
