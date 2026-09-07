import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

import type { InvoiceCompany } from '../../data/entities'
import { requireInvoiceScope, type InvoiceScope } from '../../data/scope'
import { invoiceCompanyIdSchema } from '../../data/validators'
import {
  invoiceCommonErrors,
  invoicePartnersTag,
} from '../openapi'

const logger = createLogger('invoice').child({ component: 'partners-api' })

export const INVOICE_PARTNER_RESOURCE_KIND = 'invoice.company'
export const invoicePartnerRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.settings.manage'],
} as const

export const invoicePartnerParamSchema = z.object({
  id: invoiceCompanyIdSchema,
})

export const invoicePartnerDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  taxCode: z.string(),
  countryCode: z.string(),
  defaultDueDays: z.number().int().nullable(),
  nameSourceDate: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const invoicePartnerListResponseSchema = z.object({
  items: z.array(invoicePartnerDtoSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
})

export const invoicePartnerMatchResponseSchema = z.object({
  partner: invoicePartnerDtoSchema.nullable(),
})

export const invoicePartnerUpdateResponseSchema = z.object({
  ok: z.literal(true),
  partner: invoicePartnerDtoSchema,
})

export const invoicePartnerRouteErrors: OpenApiResponseDoc[] = [...invoiceCommonErrors]
export { invoicePartnersTag }

export type InvoicePartnerRouteContext = {
  container: AwilixContainer
  auth: AuthContext
  userId: string
  scope: InvoiceScope
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function toInvoicePartnerDto(company: InvoiceCompany): z.infer<typeof invoicePartnerDtoSchema> {
  return {
    id: company.id,
    name: company.name,
    taxCode: company.taxCode,
    countryCode: company.countryCode,
    defaultDueDays: company.defaultDueDays ?? null,
    nameSourceDate: toIso(company.nameSourceDate),
    updatedAt: toIso(company.updatedAt),
  }
}

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function readRequestRecord(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export async function resolveInvoicePartnerRouteContext(req: Request): Promise<InvoicePartnerRouteContext> {
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
    em: container.resolve('em') as EntityManager,
    translate,
  }
}

export async function handleInvoicePartnerRouteError(err: unknown, label: string): Promise<NextResponse> {
  if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
  const { translate } = await resolveTranslations()
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
  }
  logger.error('Invoice partner route failed', { label, err })
  return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
}
