import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export type InvoiceScope = {
  tenantId: string
  organizationId: string
}

export type InvoiceScopeContext = {
  auth?: {
    tenantId?: string | null
    orgId?: string | null
  } | null
  selectedOrganizationId?: string | null
  organizationScope?: {
    selectedId?: string | null
  } | null
}

export type InvoiceScopedRecord = {
  tenantId?: string | null
  organizationId?: string | null
}

function normalizeScopeId(candidate: unknown): string | null {
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null
}

export function requireInvoiceScope(ctx: InvoiceScopeContext): InvoiceScope {
  const tenantId = normalizeScopeId(ctx.auth?.tenantId)
  const organizationId =
    normalizeScopeId(ctx.selectedOrganizationId) ??
    normalizeScopeId(ctx.organizationScope?.selectedId) ??
    normalizeScopeId(ctx.auth?.orgId)

  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required.' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required.' })

  return { tenantId, organizationId }
}

export function invoiceScopeWhere<TWhere extends Record<string, unknown>>(
  scope: InvoiceScope,
  where: TWhere,
): TWhere & InvoiceScope {
  return {
    ...where,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
}

export function assignInvoiceScope<TPayload extends Record<string, unknown>>(
  payload: TPayload,
  scope: InvoiceScope,
): TPayload & InvoiceScope {
  return {
    ...payload,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
}

export function assertInvoiceSameScope(entity: InvoiceScopedRecord | null | undefined, scope: InvoiceScope): void {
  if (!entity || entity.tenantId !== scope.tenantId || entity.organizationId !== scope.organizationId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}
