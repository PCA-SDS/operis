import type { AwilixContainer } from 'awilix'
import { type AuthContext, getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

const logger = createLogger('planner').child({ component: 'access' })

type TranslateFn = (key: string, fallback?: string) => string

export type AvailabilityAccessContext = {
  container: AwilixContainer
  auth: AuthContext | null
  selectedOrganizationId?: string | null
}

export type AvailabilityWriteAccess = {
  canManageAll: boolean
  canManageSelf: boolean
  canManageUnavailability: boolean
  memberId: string | null
  tenantId: string | null
  organizationId: string | null
  unregistered?: boolean
}

type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

function buildForbiddenError(translate: TranslateFn) {
  return new CrudHttpError(403, {
    error: translate('planner.availability.errors.unauthorized', 'Unauthorized'),
  })
}

function buildStaffModuleNotLoadedError() {
  return new CrudHttpError(403, { error: 'staff_module_not_loaded' })
}

export async function resolveAvailabilityWriteAccess(
  ctx: AvailabilityAccessContext,
): Promise<AvailabilityWriteAccess> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const resolver = ctx.container.resolve<AvailabilityAccessResolver | undefined>(
    'availabilityAccessResolver',
    { allowUnregistered: true },
  )
  if (!resolver) {
    logger.warn('Staff module not loaded — availabilityAccessResolver unregistered; denying availability write access')
    return {
      canManageAll: false,
      canManageSelf: false,
      canManageUnavailability: false,
      memberId: null,
      tenantId,
      organizationId,
      unregistered: true,
    }
  }
  return resolver.resolveAvailabilityWriteAccess(ctx)
}

export async function assertAvailabilityWriteAccess(
  ctx: AvailabilityAccessContext,
  params: { subjectType: string; subjectId: string; requiresUnavailability?: boolean },
  translate: TranslateFn,
): Promise<AvailabilityWriteAccess> {
  const access = await resolveAvailabilityWriteAccess(ctx)
  if (access.unregistered) throw buildStaffModuleNotLoadedError()
  if (access.canManageAll) return access
  if (!access.canManageSelf) throw buildForbiddenError(translate)
  if (!access.memberId || params.subjectType !== 'member' || params.subjectId !== access.memberId) {
    throw buildForbiddenError(translate)
  }
  if (params.requiresUnavailability && !access.canManageUnavailability) {
    throw buildForbiddenError(translate)
  }
  return access
}

export function resolveAvailabilityActorId(auth: AuthContext): string {
  if (auth) {
    if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
    if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
    if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  }
  return 'system'
}

export type RequestContext = {
  ctx: CommandRuntimeContext
}

export async function resolveAvailabilityRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('planner.availability.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('planner.availability.errors.organizationRequired', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx }
}
