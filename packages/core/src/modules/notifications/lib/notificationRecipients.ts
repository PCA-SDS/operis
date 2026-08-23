import type { Kysely } from 'kysely'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { getOwningModuleId } from '@open-mercato/shared/security/enabledModulesRegistry'
import {
  isEntitleableModule,
  isEntitlementEnforceable,
} from '@open-mercato/core/modules/directory/lib/tenantModules'

interface AclRow {
  user_id: string
  features_json: unknown
  is_super_admin: boolean
}

function normalizeFeatures(features: unknown): string[] | undefined {
  if (!Array.isArray(features)) return undefined
  const normalized = features.filter((feature): feature is string => typeof feature === 'string')
  return normalized.length ? normalized : undefined
}

/**
 * Extract user IDs from ACL rows that have the required feature or are super admins.
 */
function collectUsersWithFeature(
  userIdsSet: Set<string>,
  rows: AclRow[],
  requiredFeature: string
): void {
  for (const row of rows) {
    const features = normalizeFeatures(row.features_json) ?? []
    if (authorizeFeatures([requiredFeature], {
      grantedFeatures: features,
      unrestricted: row.is_super_admin,
    })) {
      userIdsSet.add(row.user_id)
    }
  }
}

export async function getScopedNotificationRecipientUserIds(
  db: Kysely<any>,
  tenantId: string,
  organizationId: string | null,
  recipientUserIds: string[],
): Promise<string[]> {
  const builder: any = db
  let query = builder
    .selectFrom('users')
    .where('users.id', 'in', recipientUserIds)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', tenantId)

  if (organizationId) {
    query = query.where('users.organization_id', '=', organizationId)
  }

  const users = await query
    .select('users.id as user_id')
    .execute() as Array<{ user_id: string }>

  return users.map((user) => user.user_id)
}

export async function getRecipientUserIdsForRole(
  db: Kysely<any>,
  tenantId: string,
  roleId: string
): Promise<string[]> {
  const builder: any = db
  const userRoles = await builder
    .selectFrom('user_roles')
    .innerJoin('users', 'user_roles.user_id', 'users.id')
    .where('user_roles.role_id', '=', roleId)
    .where('user_roles.deleted_at', 'is', null)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', tenantId)
    .select('users.id as user_id')
    .execute() as Array<{ user_id: string }>

  return userRoles.map((row) => row.user_id)
}

/**
 * Narrows a feature-derived recipient list to the users who may actually reach
 * the owning module.
 *
 * Recipients are selected from raw `role_acls` / `user_acls` rows for fan-out
 * efficiency, which skips `RbacService` and therefore both entitlement layers.
 * Without this pass a user whose tenant lost the module — or who a tenant admin
 * withheld it from — would still be notified about it, leaving a visible
 * reference to something they cannot open.
 *
 * The policy itself is not reimplemented here: owning-module resolution and the
 * platform-module exemption come from the same helpers `RbacService` and
 * `TenantModuleService` use, and the two entitlement tables are read with the
 * same fail-closed / subtract-only semantics. Only the data access differs,
 * because this path has a Kysely handle rather than a container.
 */
async function filterRecipientsByEntitlement(
  db: Kysely<any>,
  tenantId: string,
  requiredFeature: string,
  userIds: string[],
): Promise<string[]> {
  if (!userIds.length) return userIds
  const owningModule = getOwningModuleId(requiredFeature)
  if (!isEntitlementEnforceable() || !isEntitleableModule(owningModule)) return userIds

  const builder: any = db
  const tenantRow = await builder
    .selectFrom('tenant_modules')
    .where('tenant_modules.tenant_id', '=', tenantId)
    .where('tenant_modules.module_id', '=', owningModule)
    .where('tenant_modules.is_enabled', '=', true)
    .where('tenant_modules.deleted_at', 'is', null)
    .select('tenant_modules.module_id as module_id')
    .executeTakeFirst() as { module_id: string } | undefined
  // Fail-closed, matching `TenantModuleService`: no enabled row means the tenant
  // does not have the module, so nobody in it is a valid recipient.
  if (!tenantRow) return []

  const restrictedRows = await builder
    .selectFrom('user_modules')
    .where('user_modules.user_id', 'in', userIds)
    .where('user_modules.module_id', '=', owningModule)
    .where('user_modules.is_enabled', '=', false)
    .where('user_modules.deleted_at', 'is', null)
    .select('user_modules.user_id as user_id')
    .execute() as Array<{ user_id: string }>
  if (!restrictedRows.length) return userIds

  const restricted = new Set(restrictedRows.map((row) => row.user_id))
  return userIds.filter((userId) => !restricted.has(userId))
}

export async function getRecipientUserIdsForFeature(
  db: Kysely<any>,
  tenantId: string,
  requiredFeature: string
): Promise<string[]> {
  const userIdsSet = new Set<string>()
  const builder: any = db

  const userAcls = await builder
    .selectFrom('user_acls')
    .innerJoin('users', 'user_acls.user_id', 'users.id')
    .where('user_acls.tenant_id', '=', tenantId)
    .where('user_acls.deleted_at', 'is', null)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', tenantId)
    .select([
      'users.id as user_id',
      'user_acls.features_json',
      'user_acls.is_super_admin',
    ])
    .execute() as AclRow[]

  collectUsersWithFeature(userIdsSet, userAcls, requiredFeature)

  const roleAcls = await builder
    .selectFrom('role_acls')
    .innerJoin('user_roles', 'role_acls.role_id', 'user_roles.role_id')
    .innerJoin('users', 'user_roles.user_id', 'users.id')
    .where('role_acls.tenant_id', '=', tenantId)
    .where('role_acls.deleted_at', 'is', null)
    .where('user_roles.deleted_at', 'is', null)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', tenantId)
    .select([
      'users.id as user_id',
      'role_acls.features_json',
      'role_acls.is_super_admin',
    ])
    .execute() as AclRow[]

  collectUsersWithFeature(userIdsSet, roleAcls, requiredFeature)

  return filterRecipientsByEntitlement(db, tenantId, requiredFeature, Array.from(userIdsSet))
}
