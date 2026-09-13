import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  actorScopeForDecryption,
  applyActorScopeToWhere,
  ensureOrganizationScope,
  ensureTenantScope,
  explicitCommandActorScope,
  resolveCommandActorScope,
  type CommandActorScope,
} from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMember } from '../data/entities'

export { ensureOrganizationScope, ensureTenantScope, extractUndoPayload }

/**
 * Tenant/organization scoping for staff commands. The implementation is the
 * platform one in `@open-mercato/shared/lib/commands/scope` — staff only
 * re-exports it under the module-local names its handlers already use, so the
 * rule cannot drift away from the identical planner copy again.
 */
export {
  resolveCommandActorScope as commandActorScope,
  explicitCommandActorScope as explicitStaffCommandScope,
  applyActorScopeToWhere as applyScopeToWhere,
  actorScopeForDecryption as scopeForDecryption,
}
export type StaffCommandScope = CommandActorScope

export function commandInputScope(
  ctx: CommandRuntimeContext,
  tenantId: string,
  organizationId: string,
): StaffCommandScope {
  if (ctx.auth?.isSuperAdmin === true || ctx.systemActor === true) {
    return explicitCommandActorScope(tenantId, organizationId)
  }

  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)

  const actorTenantId = ctx.auth?.tenantId ?? ctx.organizationScope?.tenantId ?? null
  if (!actorTenantId || actorTenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }

  if (!ctx.organizationScope) {
    const currentOrganizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!currentOrganizationId || currentOrganizationId !== organizationId) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
  }

  return explicitCommandActorScope(tenantId, organizationId)
}

export type StaffSnapshotScope = {
  tenantId?: string | null
  organizationId?: string | null
}

type StaffSnapshotScopeSource = {
  tenantId?: string | null
  organizationId?: string | null
}

const NULL_DECRYPTION_SCOPE = { tenantId: null, organizationId: null } as const

export function staffSnapshotScopeFromContext(ctx: CommandRuntimeContext): StaffSnapshotScope | null {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) return null
  return { tenantId }
}

export function staffSnapshotScopeFromSnapshot(source: StaffSnapshotScopeSource | null | undefined): StaffSnapshotScope | null {
  if (!source?.tenantId || !source.organizationId) return null
  return { tenantId: source.tenantId, organizationId: source.organizationId }
}

export function scopedStaffSnapshotWhere(id: string, scope?: StaffSnapshotScope | null) {
  const where: { id: string; tenantId?: string; organizationId?: string } = { id }
  if (scope?.tenantId) where.tenantId = scope.tenantId
  if (scope?.organizationId) where.organizationId = scope.organizationId
  return where
}

export function staffSnapshotDecryptionScope(scope?: StaffSnapshotScope | null) {
  if (!scope) return NULL_DECRYPTION_SCOPE
  return {
    tenantId: scope.tenantId ?? null,
    organizationId: scope.organizationId ?? null,
  }
}

export async function requireTeamMember(
  em: EntityManager,
  memberId: string,
  scope: StaffCommandScope,
  message = 'Team member not found',
): Promise<StaffTeamMember> {
  const member = await em.findOne(
    StaffTeamMember,
    applyActorScopeToWhere<StaffTeamMember>({ id: memberId, deletedAt: null }, scope),
  )
  if (!member) throw new CrudHttpError(404, { error: message })
  return member
}
