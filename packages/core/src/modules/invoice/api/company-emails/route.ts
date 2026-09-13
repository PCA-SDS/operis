import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import {
  invoiceCompanyEmailListQuerySchema,
  invoiceCompanyEmailRecordSchema,
} from '../../data/validators'
import type { InvoiceCompanyEmailsService } from '../../services/company-emails-service'
import { createInvoiceOperationId } from '../openapi'
import {
  handleInvoiceCompanyEmailRouteError,
  INVOICE_COMPANY_EMAIL_RESOURCE_KIND,
  invoiceCompanyEmailListResponseSchema,
  invoiceCompanyEmailRecordResponseSchema,
  invoiceCompanyEmailRouteErrors,
  invoiceCompanyEmailRouteMetadata,
  invoiceCompanyEmailsTag,
  readRequestRecord,
  resolveInvoiceCompanyEmailRouteContext,
  toInvoiceCompanyEmailDto,
} from './shared'

export const metadata = {
  GET: invoiceCompanyEmailRouteMetadata,
  POST: invoiceCompanyEmailRouteMetadata,
}

export async function GET(req: Request) {
  try {
    const context = await resolveInvoiceCompanyEmailRouteContext(req)
    const url = new URL(req.url)
    const query = invoiceCompanyEmailListQuerySchema.parse({
      companyId: url.searchParams.get('companyId') ?? undefined,
    })
    const service = context.container.resolve<InvoiceCompanyEmailsService>('invoiceCompanyEmailsService')
    const items = await service.listByCompany(context.scope, query.companyId)

    return NextResponse.json({ items: items.map(toInvoiceCompanyEmailDto) })
  } catch (err) {
    return handleInvoiceCompanyEmailRouteError(err, 'list company emails')
  }
}

export async function POST(req: Request) {
  try {
    const parsed = invoiceCompanyEmailRecordSchema.parse(await readRequestRecord(req))
    const context = await resolveInvoiceCompanyEmailRouteContext(req)
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.userId,
        tenantId: context.scope.tenantId,
        organizationId: context.scope.organizationId,
      },
      input: {
        resourceKind: INVOICE_COMPANY_EMAIL_RESOURCE_KIND,
        resourceId: parsed.companyId,
        operation: 'create',
        mutationPayload: parsed,
      },
    })
    if (!guarded.ok) return guarded.response

    const guardedPayload = guarded.modifiedPayload
      ? invoiceCompanyEmailRecordSchema.parse({ ...parsed, ...guarded.modifiedPayload })
      : parsed
    const service = context.container.resolve<InvoiceCompanyEmailsService>('invoiceCompanyEmailsService')
    const email = await service.record(context.scope, guardedPayload)
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, email: email ? toInvoiceCompanyEmailDto(email) : null })
  } catch (err) {
    return handleInvoiceCompanyEmailRouteError(err, 'record company email')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceCompanyEmailsTag,
  summary: 'Manage invoice company email memory',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('companyEmails', 'list'),
      summary: 'List saved company emails',
      description: 'Returns saved recipient emails for a scoped invoice company, newest use first.',
      query: invoiceCompanyEmailListQuerySchema,
      responses: [
        { status: 200, description: 'Company email list', schema: invoiceCompanyEmailListResponseSchema },
      ],
      errors: invoiceCompanyEmailRouteErrors,
    },
    POST: {
      operationId: createInvoiceOperationId('companyEmails', 'record'),
      summary: 'Record a company email',
      description: 'Upserts a saved recipient email for a scoped invoice company.',
      requestBody: {
        schema: invoiceCompanyEmailRecordSchema,
      },
      responses: [
        { status: 200, description: 'Company email recorded', schema: invoiceCompanyEmailRecordResponseSchema },
      ],
      errors: invoiceCompanyEmailRouteErrors,
    },
  },
}
