import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

import type { InvoiceAutoPaidTaxCode } from '../../data/entities'
import {
  invoiceAutoPaidCandidateDtoSchema,
  invoiceAutoPaidTaxCodeIdSchema,
  invoiceIdSchema,
} from '../../data/validators'
import { invoiceAutoPaidTag, invoiceCommonErrors, invoiceInvoicesTag } from '../openapi'
import { translateInvoiceErrorBody } from '../../data/errors'
import { toIsoOrNull } from '@open-mercato/shared/lib/date/normalize'
import type { InvoiceRouteContext } from '../routeContext'
import { toRecord } from '@open-mercato/shared/lib/guards'

const logger = createLogger('invoice').child({ component: 'auto-paid-api' })

export const INVOICE_AUTO_PAID_RESOURCE_KIND = 'invoice.auto_paid_tax_code'
export const INVOICE_INVOICE_RESOURCE_KIND = 'invoice.invoice'

export { invoiceAutoPaidTag, invoiceInvoicesTag }

export const invoiceAutoPaidRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.settings.manage'],
} as const

export const invoiceReverseAutoPaidRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.manage'],
} as const

export const invoiceAutoPaidParamSchema = z.object({
  id: invoiceAutoPaidTaxCodeIdSchema,
})

export const invoiceAutoPaidReverseParamSchema = z.object({
  id: invoiceIdSchema,
})

export const invoiceAutoPaidRuleDtoSchema = z.object({
  id: z.string().uuid(),
  taxCode: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export { invoiceAutoPaidCandidateDtoSchema }

export const invoiceAutoPaidListResponseSchema = z.object({
  items: z.array(invoiceAutoPaidRuleDtoSchema),
})

export const invoiceAutoPaidCandidatesResponseSchema = z.object({
  items: z.array(invoiceAutoPaidCandidateDtoSchema),
})

export const invoiceAutoPaidAddResponseSchema = z.object({
  ok: z.literal(true),
  ruleId: z.string().uuid(),
  taxCode: z.string(),
  settledCount: z.number().int().nonnegative(),
})

export const invoiceAutoPaidRemoveResponseSchema = z.object({
  ok: z.literal(true),
  ruleId: z.string().uuid(),
  taxCode: z.string(),
  revertedCount: z.number().int().nonnegative(),
})

export const invoiceAutoPaidReverseResponseSchema = z.object({
  ok: z.literal(true),
  invoiceId: z.string().uuid(),
  reversed: z.literal(true),
})

export const invoiceAutoPaidRouteErrors: OpenApiResponseDoc[] = [...invoiceCommonErrors]

export function toInvoiceAutoPaidRuleDto(
  rule: InvoiceAutoPaidTaxCode,
): z.infer<typeof invoiceAutoPaidRuleDtoSchema> {
  return {
    id: rule.id,
    taxCode: rule.taxCode,
    createdAt: toIsoOrNull(rule.createdAt),
    updatedAt: toIsoOrNull(rule.updatedAt),
  }
}

export async function readRequestRecord(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export function buildInvoiceCommandContext(
  context: InvoiceRouteContext,
  req: Request,
): CommandRuntimeContext {
  return {
    container: context.container,
    auth: context.auth,
    organizationScope: context.organizationScope,
    selectedOrganizationId: context.scope.organizationId,
    organizationIds: [context.scope.organizationId],
    request: req,
  }
}

export async function handleInvoiceAutoPaidRouteError(
  err: unknown,
  label: string,
): Promise<NextResponse> {
  const { translate } = await resolveTranslations()
  if (isCrudHttpError(err)) {
    return NextResponse.json(translateInvoiceErrorBody(err.body, translate), { status: err.status })
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
  }
  logger.error('Invoice auto-paid route failed', { label, err })
  return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
}

