import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

import type { InvoiceAutoPaidRemoveInput } from '../../../services/auto-paid-service'
import type { InvoiceAutoPaidRemoveCommandResult } from '../../../commands/auto-paid'
import { createInvoiceOperationId } from '../../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceAutoPaidRouteError,
  INVOICE_AUTO_PAID_RESOURCE_KIND,
  invoiceAutoPaidParamSchema,
  invoiceAutoPaidRemoveResponseSchema,
  invoiceAutoPaidRouteErrors,
  invoiceAutoPaidRouteMetadata,
  invoiceAutoPaidTag,
  resolveInvoiceAutoPaidRouteContext,
} from '../shared'

export const metadata = {
  DELETE: invoiceAutoPaidRouteMetadata,
}

type RouteContext = {
  params?: Promise<{ id?: string }> | { id?: string }
}

export async function DELETE(req: Request, routeContext: RouteContext = {}) {
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceAutoPaidParamSchema.parse(rawParams)
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
        resourceKind: INVOICE_AUTO_PAID_RESOURCE_KIND,
        resourceId: params.id,
        operation: 'delete',
        mutationPayload: { id: params.id },
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const cmdCtx = buildInvoiceCommandContext(context, req)
    const { result } = await commandBus.execute<InvoiceAutoPaidRemoveInput, InvoiceAutoPaidRemoveCommandResult>(
      'invoice.auto_paid.remove',
      { input: { id: params.id }, ctx: cmdCtx },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({
      ok: true,
      ruleId: result.ruleId,
      taxCode: result.taxCode,
      revertedCount: result.revertedCount,
    })
  } catch (err) {
    return handleInvoiceAutoPaidRouteError(err, 'remove auto-paid rule')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceAutoPaidTag,
  summary: 'Remove auto-paid rule',
  methods: {
    DELETE: {
      operationId: createInvoiceOperationId('autoPaid', 'remove'),
      summary: 'Remove auto-paid rule',
      description: 'Removes an auto-paid supplier tax code rule and reverts auto-settled AP invoices.',
      pathParams: invoiceAutoPaidParamSchema,
      responses: [
        { status: 200, description: 'Auto-paid rule removed', schema: invoiceAutoPaidRemoveResponseSchema },
      ],
      errors: invoiceAutoPaidRouteErrors,
    },
  },
}

