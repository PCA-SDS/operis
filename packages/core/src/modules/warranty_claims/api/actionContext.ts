import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  WARRANTY_CLAIM_LINE_RESOURCE_KIND,
  WARRANTY_CLAIM_RESOURCE_KIND,
  type WarrantyClaimScope,
} from '../commands/shared'
import type { EntityManager } from '@mikro-orm/postgresql'

export type ActionRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export async function resolveActionContext(req: Request): Promise<ActionRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  return {
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

export type ScopedRouteContext = {
  tenantId: string
  organizationId: string
  scope: WarrantyClaimScope
  em: EntityManager
}

export async function resolveScopedRouteContext(req: Request): Promise<ScopedRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  const em = container.resolve('em') as EntityManager
  return {
    tenantId: auth.tenantId,
    organizationId,
    scope: { tenantId: auth.tenantId, organizationId },
    em,
  }
}

type GuardRouteContext = Pick<ActionRouteContext, 'ctx' | 'tenantId' | 'organizationId' | 'translate'>

function requireGuardUserId(context: GuardRouteContext): string {
  const userId = context.ctx.auth?.sub
  if (!userId) {
    throw new CrudHttpError(401, { error: context.translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  return userId
}

export async function runClaimActionGuard(
  req: Request,
  context: GuardRouteContext,
  claimId: string,
  mutationPayload: Record<string, unknown>,
): Promise<RouteMutationGuardResult> {
  return runRouteMutationGuards({
    container: context.ctx.container,
    req,
    auth: {
      userId: requireGuardUserId(context),
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    input: {
      resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
      resourceId: claimId,
      operation: 'custom',
      mutationPayload,
    },
  })
}

export async function runClaimLineActionGuard(
  req: Request,
  context: GuardRouteContext,
  lineId: string,
  mutationPayload: Record<string, unknown>,
): Promise<RouteMutationGuardResult> {
  return runRouteMutationGuards({
    container: context.ctx.container,
    req,
    auth: {
      userId: requireGuardUserId(context),
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    input: {
      resourceKind: WARRANTY_CLAIM_LINE_RESOURCE_KIND,
      resourceId: lineId,
      operation: 'custom',
      mutationPayload,
    },
  })
}
