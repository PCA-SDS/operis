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

import type { InvoiceCompanyEmail } from '../../data/entities'
import { requireInvoiceScope, type InvoiceScope } from '../../data/scope'
import { invoiceCompanyEmailIdSchema } from '../../data/validators'
import { invoiceCommonErrors } from '../openapi'

const logger = createLogger('invoice').child({ component: 'company-emails-api' })

export const INVOICE_COMPANY_EMAIL_RESOURCE_KIND = 'invoice.company_email'
export const invoiceCompanyEmailsTag = 'Invoice Company Emails'
export const invoiceCompanyEmailRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.manage'],
} as const

export const invoiceCompanyEmailParamSchema = z.object({
  id: invoiceCompanyEmailIdSchema,
})

export const invoiceCompanyEmailDtoSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  email: z.string(),
  updatedAt: z.string().nullable(),
})

export const invoiceCompanyEmailListResponseSchema = z.object({
  items: z.array(invoiceCompanyEmailDtoSchema),
})

export const invoiceCompanyEmailRecordResponseSchema = z.object({
  ok: z.literal(true),
  email: invoiceCompanyEmailDtoSchema.nullable(),
})

export const invoiceCompanyEmailDeleteResponseSchema = z.object({
  ok: z.literal(true),
})

export const invoiceCompanyEmailRouteErrors: OpenApiResponseDoc[] = [...invoiceCommonErrors]

export type InvoiceCompanyEmailRouteContext = {
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

export function toInvoiceCompanyEmailDto(
  email: InvoiceCompanyEmail,
): z.infer<typeof invoiceCompanyEmailDtoSchema> {
  return {
    id: email.id,
    companyId: email.company.id,
    email: email.email,
    updatedAt: toIso(email.updatedAt),
  }
}

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function readRequestRecord(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export async function resolveInvoiceCompanyEmailRouteContext(
  req: Request,
): Promise<InvoiceCompanyEmailRouteContext> {
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

export async function handleInvoiceCompanyEmailRouteError(
  err: unknown,
  label: string,
): Promise<NextResponse> {
  if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
  const { translate } = await resolveTranslations()
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
  }
  logger.error('Invoice company email route failed', { label, err })
  return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
}
