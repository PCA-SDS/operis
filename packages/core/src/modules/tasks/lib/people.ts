// Reading people and roles out of the auth module. Tasks references users and
// roles by plain uuid (no cross-module ORM relation), so every display name is
// resolved through here. `User.email` is encrypted at rest, which is why these
// reads go through `findWithDecryption` rather than `em.find`.

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, User, UserRole } from '../../auth/data/entities'
import type { AssignableUserDto, TaskUserDto } from '../data/types'

export type TasksScope = {
  tenantId: string
  organizationId: string
}

export type PersonRow = {
  id: string
  name: string
  email: string
}

function displayName(user: { name?: string | null; email: string }): string {
  const trimmed = (user.name ?? '').trim()
  return trimmed.length > 0 ? trimmed : user.email
}

/**
 * Everyone assignable inside the scope, ordered by display name: the
 * organization's own users plus tenant-level users who carry no organization
 * (administrators, owners). Never crosses a tenant boundary.
 */
export async function listScopedUsers(em: EntityManager, scope: TasksScope): Promise<PersonRow[]> {
  const users = await findWithDecryption(
    em,
    User,
    {
      tenantId: scope.tenantId,
      deletedAt: null,
      $or: [{ organizationId: scope.organizationId }, { organizationId: null }],
    },
    { orderBy: { createdAt: 'asc' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return users
    .map((user) => ({ id: user.id, name: displayName(user), email: user.email }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Resolve a set of user ids to display names, dropping ids that no longer
 *  exist in the tenant. Callers rely on the map to render assignee chips. */
export async function loadPeopleByIds(
  em: EntityManager,
  scope: TasksScope,
  ids: readonly string[],
): Promise<Map<string, PersonRow>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const result = new Map<string, PersonRow>()
  if (unique.length === 0) return result
  const users = await findWithDecryption(
    em,
    User,
    { id: { $in: unique }, tenantId: scope.tenantId, deletedAt: null },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  for (const user of users) {
    result.set(user.id, { id: user.id, name: displayName(user), email: user.email })
  }
  return result
}

export function toTaskUser(person: PersonRow | undefined | null): TaskUserDto | null {
  if (!person) return null
  return { id: person.id, name: person.name }
}

export function toAssignableUser(person: PersonRow): AssignableUserDto {
  return { id: person.id, name: person.name, email: person.email }
}

/** Every user id that is a member of at least one of the given roles. */
export async function loadUserIdsByRoleIds(
  em: EntityManager,
  roleIds: readonly string[],
): Promise<Map<string, string[]>> {
  const unique = [...new Set(roleIds)]
  const result = new Map<string, string[]>()
  if (unique.length === 0) return result
  const links = await em.find(
    UserRole,
    { role: { $in: unique as string[] }, deletedAt: null },
    { populate: ['role', 'user'] },
  )
  for (const link of links) {
    const roleId = typeof link.role === 'string' ? link.role : link.role?.id
    const userId = typeof link.user === 'string' ? link.user : link.user?.id
    if (!roleId || !userId) continue
    const bucket = result.get(roleId)
    if (bucket) bucket.push(userId)
    else result.set(roleId, [userId])
  }
  return result
}

/** The role ids a user currently holds — the input to "is this task mine?". */
export async function loadRoleIdsForUser(em: EntityManager, userId: string): Promise<string[]> {
  const links = await em.find(UserRole, { user: userId, deletedAt: null }, { populate: ['role'] })
  return links
    .map((link) => (typeof link.role === 'string' ? link.role : link.role?.id))
    .filter((id): id is string => typeof id === 'string')
}

export async function loadRolesByIds(
  em: EntityManager,
  ids: readonly string[],
): Promise<Map<string, { id: string; name: string }>> {
  const unique = [...new Set(ids)]
  const result = new Map<string, { id: string; name: string }>()
  if (unique.length === 0) return result
  const roles = await em.find(Role, { id: { $in: unique as string[] }, deletedAt: null })
  for (const role of roles) result.set(role.id, { id: role.id, name: role.name })
  return result
}

/** The tenant's roles, offered as assignment targets. */
export async function listTenantRoles(
  em: EntityManager,
  scope: TasksScope,
): Promise<{ id: string; name: string }[]> {
  const roles = await em.find(
    Role,
    { tenantId: scope.tenantId, deletedAt: null },
    { orderBy: { name: 'asc' } },
  )
  return roles.map((role) => ({ id: role.id, name: role.name }))
}

/** Role names per user id, for the Team member list. */
export async function loadRoleNamesByUserIds(
  em: EntityManager,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const unique = [...new Set(userIds)]
  const result = new Map<string, string[]>()
  if (unique.length === 0) return result
  const links = await em.find(
    UserRole,
    { user: { $in: unique as string[] }, deletedAt: null },
    { populate: ['role'] },
  )
  for (const link of links) {
    const userId = typeof link.user === 'string' ? link.user : link.user?.id
    const roleName = typeof link.role === 'string' ? null : (link.role?.name ?? null)
    if (!userId || !roleName) continue
    const bucket = result.get(userId)
    if (bucket) bucket.push(roleName)
    else result.set(userId, [roleName])
  }
  for (const names of result.values()) names.sort((a, b) => a.localeCompare(b))
  return result
}
