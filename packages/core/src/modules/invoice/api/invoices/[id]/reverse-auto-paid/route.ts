import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

import type { InvoiceAutoPaidReverseInput } from '../../../../services/auto-paid-service'
import type { InvoiceAutoPaidReverseCommandResult } from '../../../../commands/auto-paid'
import { createInvoiceOperationId } from '../../../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceAutoPaidRouteError,
  INVOICE_INVOICE_RESOURCE_KIND,
  invoiceAutoPaidReverseParamSchema,
  invoiceAutoPaidReverseResponseSchema,
  invoiceAutoPaidRouteErrors,
  invoiceInvoicesTag,
  invoiceReverseAutoPaidRouteMetadata,
  resolveInvoiceAutoPaidRouteContext,
} from '../../../auto-paid/shared'

export const metadata = {
  PATCH: invoiceReverseAutoPaidRouteMetadata,
}

type RouteContext = {
  params?: Promise<{ id?: string }> | { id?: string }
}

export async function PATCH(req: Request, routeContext: RouteContext = {}) {
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceAutoPaidReverseParamSchema.parse(rawParams)
    const context = await resolveInvoiceAutoPaidRouteContext(req)
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
        mutationPayload: { invoiceId: params.id },
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const cmdCtx = buildInvoiceCommandContext(context, req)
    const { result } = await commandBus.execute<InvoiceAutoPaidReverseInput, InvoiceAutoPaidReverseCommandResult>(
      'invoice.auto_paid.reverse',
      { input: { invoiceId: params.id }, ctx: cmdCtx },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({
      ok: true,
      invoiceId: result.invoiceId,
      reversed: true,
    })
  } catch (err) {
    return handleInvoiceAutoPaidRouteError(err, 'reverse auto-paid invoice')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Reverse auto-paid settlement on an invoice',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('invoices', 'reverseAutoPaid'),
      summary: 'Reverse auto-paid settlement',
      description: 'Reverses auto-paid settlement on an AP invoice and excludes it from future auto-paid passes.',
      pathParams: invoiceAutoPaidReverseParamSchema,
      responses: [
        { status: 200, description: 'Auto-paid settlement reversed', schema: invoiceAutoPaidReverseResponseSchema },
      ],
      errors: invoiceAutoPaidRouteErrors,
    },
  },
}

