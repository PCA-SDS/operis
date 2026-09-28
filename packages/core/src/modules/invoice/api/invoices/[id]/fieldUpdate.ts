import { NextResponse } from 'next/server'
import type { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

import type { InvoiceScope } from '../../../data/scope'
import {
  buildInvoiceCommandContext,
  handleInvoiceInvoiceRouteError,
  INVOICE_INVOICE_RESOURCE_KIND,
  invoiceInvoiceParamSchema,
  readRequestRecord,
} from '../shared'
import { resolveInvoiceRouteContext } from '../../routeContext'

export type InvoiceFieldUpdateRouteContext = {
  params?: Promise<{ id?: string }> | { id?: string }
}

type InvoiceFieldUpdateResult = { invoice: unknown }

export type InvoiceFieldUpdate<TInput extends Record<string, unknown>> = {
  schema: z.ZodType<TInput>
  commandId: 'invoice.invoices.update-due-date' | 'invoice.invoices.update-settlement' | 'invoice.invoices.update-non-recoverable'
  errorLabel: string
}

export async function runInvoiceFieldUpdate<TInput extends Record<string, unknown>>(
  req: Request,
  routeContext: InvoiceFieldUpdateRouteContext,
  update: InvoiceFieldUpdate<TInput>,
): Promise<Response> {
  let routeScope: InvoiceScope | undefined
  let invoiceId: string | undefined
  try {
    const rawParams = routeContext.params ? await routeContext.params : {}
    const params = invoiceInvoiceParamSchema.parse(rawParams)
    invoiceId = params.id
    const context = await resolveInvoiceRouteContext(req)
    routeScope = context.scope
    const input = update.schema.parse(await readRequestRecord(req))
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
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const commandInput = guarded.modifiedPayload
      ? update.schema.parse({ ...input, ...guarded.modifiedPayload })
      : input
    const { result } = await commandBus.execute<{ id: string; input: typeof commandInput }, InvoiceFieldUpdateResult>(
      update.commandId,
      { input: { id: params.id, input: commandInput }, ctx: buildInvoiceCommandContext(context, req) },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, invoice: result.invoice })
  } catch (err) {
    return handleInvoiceInvoiceRouteError(err, update.errorLabel, routeScope, invoiceId)
  }
}
