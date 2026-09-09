import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import { invoiceCompanyEmailDeleteQuerySchema } from '../../../data/validators'
import type { InvoiceCompanyEmailsService } from '../../../services/company-emails-service'
import { createInvoiceOperationId } from '../../openapi'
import {
  handleInvoiceCompanyEmailRouteError,
  INVOICE_COMPANY_EMAIL_RESOURCE_KIND,
  invoiceCompanyEmailDeleteResponseSchema,
  invoiceCompanyEmailParamSchema,
  invoiceCompanyEmailRouteErrors,
  invoiceCompanyEmailRouteMetadata,
  invoiceCompanyEmailsTag,
  resolveInvoiceCompanyEmailRouteContext,
} from '../shared'

export const metadata = {
  DELETE: invoiceCompanyEmailRouteMetadata,
}

type RouteContext = {
  params?: {
    id?: string
  }
}

export async function DELETE(req: Request, routeContext: RouteContext = {}) {
  try {
    const params = invoiceCompanyEmailParamSchema.parse({ id: routeContext.params?.id })
    const url = new URL(req.url)
    const query = invoiceCompanyEmailDeleteQuerySchema.parse({
      companyId: url.searchParams.get('companyId') ?? undefined,
    })
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
        resourceId: params.id,
        operation: 'delete',
        mutationPayload: query,
      },
    })
    if (!guarded.ok) return guarded.response

    const service = context.container.resolve<InvoiceCompanyEmailsService>('invoiceCompanyEmailsService')
    await service.remove(context.scope, { companyId: query.companyId, id: params.id })
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleInvoiceCompanyEmailRouteError(err, 'remove company email')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceCompanyEmailsTag,
  summary: 'Remove invoice company email memory',
  methods: {
    DELETE: {
      operationId: createInvoiceOperationId('companyEmails', 'remove'),
      summary: 'Remove a saved company email',
      description: 'Removes one saved recipient email from a scoped invoice company.',
      pathParams: invoiceCompanyEmailParamSchema,
      query: invoiceCompanyEmailDeleteQuerySchema,
      responses: [
        { status: 200, description: 'Company email removed', schema: invoiceCompanyEmailDeleteResponseSchema },
      ],
      errors: invoiceCompanyEmailRouteErrors,
    },
  },
}
