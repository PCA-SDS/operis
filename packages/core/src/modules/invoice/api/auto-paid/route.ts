import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

import { invoiceAutoPaidRuleUpsertSchema } from '../../data/validators'
import type { InvoiceAutoPaidRuleInput, InvoiceAutoPaidService } from '../../services/auto-paid-service'
import type { InvoiceAutoPaidAddCommandResult } from '../../commands/auto-paid'
import { createInvoiceOperationId } from '../openapi'
import {
  buildInvoiceCommandContext,
  handleInvoiceAutoPaidRouteError,
  INVOICE_AUTO_PAID_RESOURCE_KIND,
  invoiceAutoPaidAddResponseSchema,
  invoiceAutoPaidListResponseSchema,
  invoiceAutoPaidRouteErrors,
  invoiceAutoPaidRouteMetadata,
  invoiceAutoPaidTag,
  readRequestRecord,
  resolveInvoiceAutoPaidRouteContext,
  toInvoiceAutoPaidRuleDto,
} from './shared'

export const metadata = {
  GET: invoiceAutoPaidRouteMetadata,
  POST: invoiceAutoPaidRouteMetadata,
}

export async function GET(req: Request) {
  try {
    const context = await resolveInvoiceAutoPaidRouteContext(req)
    const service = context.container.resolve<InvoiceAutoPaidService>('invoiceAutoPaidService')
    const items = await service.listRules(context.scope)

    return NextResponse.json({ items: items.map(toInvoiceAutoPaidRuleDto) })
  } catch (err) {
    return handleInvoiceAutoPaidRouteError(err, 'list auto-paid rules')
  }
}

export async function POST(req: Request) {
  try {
    const parsed = invoiceAutoPaidRuleUpsertSchema.parse(await readRequestRecord(req))
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
        operation: 'create',
        mutationPayload: parsed,
      },
    })
    if (!guarded.ok) return guarded.response

    const guardedPayload = guarded.modifiedPayload
      ? invoiceAutoPaidRuleUpsertSchema.parse({ ...parsed, ...guarded.modifiedPayload })
      : parsed

    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const cmdCtx = buildInvoiceCommandContext(context, req)
    const { result } = await commandBus.execute<InvoiceAutoPaidRuleInput, InvoiceAutoPaidAddCommandResult>(
      'invoice.auto_paid.add',
      { input: guardedPayload, ctx: cmdCtx },
    )
    await guarded.runAfterSuccess()

    return NextResponse.json({
      ok: true,
      ruleId: result.ruleId,
      taxCode: result.taxCode,
      settledCount: result.settledCount,
    })
  } catch (err) {
    return handleInvoiceAutoPaidRouteError(err, 'add auto-paid rule')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceAutoPaidTag,
  summary: 'Manage invoice auto-paid rules',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('autoPaid', 'list'),
      summary: 'List auto-paid rules',
      description: 'Returns configured auto-paid supplier tax code rules for the scoped organization.',
      responses: [
        { status: 200, description: 'Auto-paid rules list', schema: invoiceAutoPaidListResponseSchema },
      ],
      errors: invoiceAutoPaidRouteErrors,
    },
    POST: {
      operationId: createInvoiceOperationId('autoPaid', 'add'),
      summary: 'Add auto-paid rule',
      description: 'Upserts an auto-paid supplier tax code rule and settles matching AP invoices.',
      requestBody: {
        schema: invoiceAutoPaidRuleUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Auto-paid rule added', schema: invoiceAutoPaidAddResponseSchema },
      ],
      errors: invoiceAutoPaidRouteErrors,
    },
  },
}

