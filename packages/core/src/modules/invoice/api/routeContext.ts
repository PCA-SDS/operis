import type { AwilixContainer } from 'awilix'
import { type AuthContext, getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { type InvoiceScope, requireInvoiceScope } from '../data/scope'
import { type OrganizationScope, resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export type InvoiceRouteContext = {
  container: AwilixContainer
  auth: AuthContext
  userId: string
  scope: InvoiceScope
  organizationScope: OrganizationScope | null
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

export async function resolveInvoiceRouteContext(
  req: Request,
): Promise<InvoiceRouteContext> {
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

export async function resolveInvoiceScopeContext(req: Request) {
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

  return { container, translate, scope }
}
