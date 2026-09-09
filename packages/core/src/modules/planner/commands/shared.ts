import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export { ensureOrganizationScope, ensureTenantScope, extractUndoPayload }

/**
 * Tenant/organization scoping for planner commands. The implementation is the
 * platform one in `@open-mercato/shared/lib/commands/scope` — planner only
 * re-exports it under the module-local names its handlers already use, so the
 * rule cannot drift away from the identical staff copy again.
 */
export {
  resolveCommandActorScope as commandActorScope,
  explicitCommandActorScope as explicitPlannerCommandScope,
  applyActorScopeToWhere as applyScopeToWhere,
  actorScopeForDecryption as scopeForDecryption,
} from '@open-mercato/shared/lib/commands/scope'
export type { CommandActorScope as PlannerCommandScope } from '@open-mercato/shared/lib/commands/scope'
