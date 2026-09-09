import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'

import { invoicePartnerTermsUpdateSchema } from '../../../data/validators'
import type { InvoicePartnerTermsService } from '../../../services/partner-terms-service'
import { createInvoiceOperationId } from '../../openapi'
import {
  handleInvoicePartnerRouteError,
  INVOICE_PARTNER_RESOURCE_KIND,
  invoicePartnerParamSchema,
  invoicePartnerRouteErrors,
  invoicePartnerRouteMetadata,
  invoicePartnerUpdateResponseSchema,
  invoicePartnersTag,
  readRequestRecord,
  resolveInvoicePartnerRouteContext,
  toInvoicePartnerDto,
} from '../shared'

export const metadata = {
  PATCH: invoicePartnerRouteMetadata,
}

type RouteContext = {
  params?: {
    id?: string
  }
}

export async function PATCH(req: Request, routeContext: RouteContext = {}) {
  try {
    const params = invoicePartnerParamSchema.parse({ id: routeContext.params?.id })
    const parsed = invoicePartnerTermsUpdateSchema.parse(await readRequestRecord(req))
    const context = await resolveInvoicePartnerRouteContext(req)
    const service = context.container.resolve<InvoicePartnerTermsService>('invoicePartnerTermsService')
    const partner = await service.getPartner(context.scope, params.id)
    if (!partner) {
      throw new CrudHttpError(404, { error: context.translate('invoice.errors.partner_not_found', 'Partner not found') })
    }

    try {
      await enforceCommandOptimisticLockWithGuards(context.container, {
        resourceKind: INVOICE_PARTNER_RESOURCE_KIND,
        resourceId: partner.id,
        current: partner.updatedAt ?? null,
        request: req,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }

    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.userId,
        tenantId: context.scope.tenantId,
        organizationId: context.scope.organizationId,
      },
      input: {
        resourceKind: INVOICE_PARTNER_RESOURCE_KIND,
        resourceId: partner.id,
        operation: 'update',
        mutationPayload: parsed,
      },
    })
    if (!guarded.ok) return guarded.response

    const guardedPayload = guarded.modifiedPayload
      ? invoicePartnerTermsUpdateSchema.parse({ ...parsed, ...guarded.modifiedPayload })
      : parsed
    const updated = await service.updateDefaultDueDays(context.scope, partner.id, guardedPayload)
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, partner: toInvoicePartnerDto(updated) })
  } catch (err) {
    return handleInvoicePartnerRouteError(err, 'update partner payment terms')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePartnersTag,
  summary: 'Update invoice partner payment terms',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('partners', 'updateTerms'),
      summary: 'Update invoice partner payment terms',
      description: 'Updates only the default due days for a scoped invoice partner.',
      pathParams: invoicePartnerParamSchema,
      requestBody: {
        schema: invoicePartnerTermsUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Partner payment terms updated', schema: invoicePartnerUpdateResponseSchema },
      ],
      errors: invoicePartnerRouteErrors,
    },
  },
}
