import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { invoicePartnerMatchQuerySchema } from '../../../data/validators'
import type { InvoicePartnerTermsService } from '../../../services/partner-terms-service'
import { createInvoiceOperationId } from '../../openapi'
import {
  handleInvoicePartnerRouteError,
  invoicePartnerMatchResponseSchema,
  invoicePartnerRouteErrors,
  invoicePartnerRouteMetadata,
  invoicePartnersTag,
  resolveInvoicePartnerRouteContext,
  toInvoicePartnerDto,
} from '../shared'

export const metadata = {
  GET: invoicePartnerRouteMetadata,
}

export async function GET(req: Request) {
  try {
    const context = await resolveInvoicePartnerRouteContext(req)
    const url = new URL(req.url)
    const query = invoicePartnerMatchQuerySchema.parse({
      taxCode: url.searchParams.get('taxCode') ?? undefined,
      name: url.searchParams.get('name') ?? undefined,
    })
    const service = context.container.resolve<InvoicePartnerTermsService>('invoicePartnerTermsService')
    const partner = await service.matchPartner(context.scope, query)

    return NextResponse.json({ partner: partner ? toInvoicePartnerDto(partner) : null })
  } catch (err) {
    return handleInvoicePartnerRouteError(err, 'match partner')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePartnersTag,
  summary: 'Match invoice partner',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('partners', 'match'),
      summary: 'Match invoice partner',
      description: 'Matches a scoped invoice partner by tax code or company name.',
      query: invoicePartnerMatchQuerySchema,
      responses: [
        { status: 200, description: 'Partner match', schema: invoicePartnerMatchResponseSchema },
      ],
      errors: invoicePartnerRouteErrors,
    },
  },
}
