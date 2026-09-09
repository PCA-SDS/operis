import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest, type OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

import type { InvoiceAutoPaidTaxCode } from '../../data/entities'
import { requireInvoiceScope, type InvoiceScope } from '../../data/scope'
import {
  invoiceAutoPaidCandidateDtoSchema,
  invoiceAutoPaidTaxCodeIdSchema,
  invoiceIdSchema,
} from '../../data/validators'
import { invoiceAutoPaidTag, invoiceCommonErrors, invoiceInvoicesTag } from '../openapi'

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

export type InvoiceAutoPaidRouteContext = {
  container: AwilixContainer
  auth: AuthContext
  userId: string
  scope: InvoiceScope
  organizationScope: OrganizationScope | null
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function toInvoiceAutoPaidRuleDto(
  rule: InvoiceAutoPaidTaxCode,
): z.infer<typeof invoiceAutoPaidRuleDtoSchema> {
  return {
    id: rule.id,
    taxCode: rule.taxCode,
    createdAt: toIso(rule.createdAt),
    updatedAt: toIso(rule.updatedAt),
  }
}

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function readRequestRecord(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export function buildInvoiceCommandContext(
  context: InvoiceAutoPaidRouteContext,
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

export async function resolveInvoiceAutoPaidRouteContext(
  req: Request,
): Promise<InvoiceAutoPaidRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.sub || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('invoice.errors.unauthorized', 'Unauthorized') })
  }

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const selectedOrganizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  const scope = requireInvoiceScope({
    auth: { tenantId: auth.tenantId, orgId: auth.orgId },
    selectedOrganizationId,
    organizationScope: organizationScope ? { selectedId: organizationScope.selectedId ?? null } : null,
  }, (key, fallback) => translate(key, fallback))

  return {
    container,
    auth,
    userId: auth.sub,
    scope,
    organizationScope: organizationScope ?? null,
    em: container.resolve('em') as EntityManager,
    translate,
  }
}

export async function handleInvoiceAutoPaidRouteError(
  err: unknown,
  label: string,
): Promise<NextResponse> {
  if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
  const { translate } = await resolveTranslations()
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
  }
  logger.error('Invoice auto-paid route failed', { label, err })
  return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
}

