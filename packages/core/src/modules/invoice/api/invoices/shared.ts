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

import { requireInvoiceScope, type InvoiceScope } from '../../data/scope'
import { invoiceIdSchema } from '../../data/validators'
import { invoiceCommonErrors, invoiceInvoicesTag } from '../openapi'

const logger = createLogger('invoice').child({ component: 'invoices-api' })

export const INVOICE_INVOICE_RESOURCE_KIND = 'invoice.invoice'
export const invoiceInvoiceRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.view'],
} as const
export const invoiceInvoiceManageRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.manage'],
} as const

export const invoiceInvoiceParamSchema = z.object({
  id: invoiceIdSchema,
})

const nullableIsoSchema = z.string().datetime().nullable()

export const invoiceListItemDtoSchema = z.object({
  id: z.string().uuid(),
  sourceInvoiceId: z.string().nullable(),
  origin: z.string().nullable(),
  direction: z.enum(['AR', 'AP']),
  companyId: z.string().uuid().nullable(),
  partnerName: z.string().nullable(),
  partnerTaxCode: z.string().nullable(),
  sellerTaxCode: z.string().nullable(),
  sellerName: z.string().nullable(),
  buyerTaxCode: z.string().nullable(),
  buyerName: z.string().nullable(),
  invoiceSymbol: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceCode: z.string().nullable(),
  invoiceDate: nullableIsoSchema,
  dueDate: nullableIsoSchema,
  dueDateSource: z.string().nullable(),
  currencyCode: z.string().nullable(),
  invoiceStatus: z.string().nullable(),
  netAmount: z.string().nullable(),
  vatAmount: z.string().nullable(),
  grossAmount: z.string().nullable(),
  hasReceived: z.boolean(),
  hasPaid: z.boolean(),
  settlementStatus: z.string().nullable(),
  settled: z.boolean(),
  paidAmount: z.string().nullable(),
  outstandingAmount: z.string().nullable(),
  nextDueDate: nullableIsoSchema,
  hasInstallmentPlan: z.boolean(),
  nonRecoverable: z.boolean(),
  nonRecoverableNote: z.string().nullable(),
  nonRecoverableAt: nullableIsoSchema,
  lastSentAt: nullableIsoSchema,
  openedAt: nullableIsoSchema,
  autoSettled: z.boolean(),
  autoPayExcluded: z.boolean(),
  createdAt: nullableIsoSchema,
  updatedAt: nullableIsoSchema,
})

export const invoiceLineItemDtoSchema = z.object({
  id: z.string().uuid(),
  lineNumber: z.number().int(),
  name: z.string(),
  unit: z.string().nullable(),
  quantity: z.string().nullable(),
  unitPrice: z.string().nullable(),
  discountAmount: z.string().nullable(),
  discountPercent: z.string().nullable(),
  vatRate: z.string().nullable(),
  vatAmount: z.string().nullable(),
  lineTotal: z.string(),
  createdAt: nullableIsoSchema,
  updatedAt: nullableIsoSchema,
})

export const invoiceInstallmentDtoSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int(),
  principalAmount: z.string(),
  interestRate: z.string(),
  interestAmount: z.string(),
  totalAmount: z.string(),
  dueDate: nullableIsoSchema,
  status: z.string(),
  paidAt: nullableIsoSchema,
  note: z.string().nullable(),
  createdAt: nullableIsoSchema,
  updatedAt: nullableIsoSchema,
})

export const invoiceListResponseSchema = z.object({
  items: z.array(invoiceListItemDtoSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
})

export const invoiceDetailResponseSchema = invoiceListItemDtoSchema.extend({
  lineItems: z.array(invoiceLineItemDtoSchema),
  installments: z.array(invoiceInstallmentDtoSchema),
})
export const invoiceManualMutationResponseSchema = z.object({
  ok: z.literal(true),
  invoice: invoiceDetailResponseSchema,
})
export const invoiceManualDeleteResponseSchema = z.object({
  ok: z.literal(true),
  invoiceId: z.string().uuid(),
  deleted: z.literal(true),
})

export const invoiceInvoiceRouteErrors: OpenApiResponseDoc[] = [...invoiceCommonErrors]
export { invoiceInvoicesTag }

export type InvoiceInvoiceRouteContext = {
  container: AwilixContainer
  auth: AuthContext
  userId: string
  scope: InvoiceScope
  organizationScope: OrganizationScope | null
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function readRequestRecord(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export function buildInvoiceCommandContext(
  context: InvoiceInvoiceRouteContext,
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

export async function resolveInvoiceInvoiceRouteContext(req: Request): Promise<InvoiceInvoiceRouteContext> {
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

export async function handleInvoiceInvoiceRouteError(
  err: unknown,
  label: string,
  scope?: InvoiceScope,
  invoiceId?: string,
): Promise<NextResponse> {
  if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
  const { translate } = await resolveTranslations()
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
  }
  logger.error('Invoice route failed', {
    label,
    invoiceId,
    tenantId: scope?.tenantId,
    organizationId: scope?.organizationId,
    err,
  })
  return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
}
