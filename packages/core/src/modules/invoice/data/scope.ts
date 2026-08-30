import { badRequest, forbidden } from '@open-mercato/shared/lib/crud/errors'

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

export type InvoiceScopeTranslate = (key: string, fallback: string) => string

const defaultTranslate: InvoiceScopeTranslate = (_key, fallback) => fallback

function normalizeScopeId(candidate: unknown): string | null {
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null
}

/**
 * Invoice scope is intentionally payload-blind.
 *
 * Do not replace this with `withScopedPayload` without changing the shared helper
 * first: that helper accepts payload-supplied tenantId/organizationId before
 * falling back to runtime context. Invoice ownership must only come from trusted
 * auth/request context, then be stamped onto persistence payloads as the last
 * write.
 *
 * `selectedOrganizationId` is treated as trusted platform context here. Invoice
 * assumes it has already been validated against the caller's accessible
 * organizations before a handler builds this scope; if that contract is wrong,
 * fix or track it at the platform scope resolver boundary.
 */
export function requireInvoiceScope(
  ctx: InvoiceScopeContext,
  translate: InvoiceScopeTranslate = defaultTranslate,
): InvoiceScope {
  const tenantId = normalizeScopeId(ctx.auth?.tenantId)
  const organizationId =
    normalizeScopeId(ctx.selectedOrganizationId) ??
    normalizeScopeId(ctx.organizationScope?.selectedId) ??
    normalizeScopeId(ctx.auth?.orgId)

  if (!tenantId) {
    throw badRequest(translate('invoice.errors.tenant_required', 'Tenant context is required.'))
  }
  if (!organizationId) {
    throw badRequest(translate('invoice.errors.organization_required', 'Organization context is required.'))
  }

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

/**
 * Guard only records loaded from persistence or another trusted lookup.
 * It is not useful after `assignInvoiceScope`, because that path just stamped
 * the same trusted scope by construction.
 */
export function assertInvoiceSameScope(entity: InvoiceScopedRecord | null | undefined, scope: InvoiceScope): void {
  if (!entity || entity.tenantId !== scope.tenantId || entity.organizationId !== scope.organizationId) {
    throw forbidden('[internal] Invoice loaded record is outside trusted scope')
  }
}
