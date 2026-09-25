import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTeamMember, StaffTeamRole } from '../data/entities'

export const metadata = {
  event: 'auth.user.organization_memberships_changed',
  persistent: true,
  id: 'staff:sync-user-organization-memberships',
}

type MembershipChangePayload = {
  userId?: unknown
  tenantId?: unknown
  organizationIds?: unknown
  staffRoleAssignments?: unknown
}

type StaffRoleAssignment = {
  organizationId: string
  roleIds: string[]
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

function readUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null
}

function readOrganizationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(readUuid).filter((id): id is string => id !== null)))
}

function readStaffRoleAssignments(value: unknown): Map<string, string[]> | null {
  if (!Array.isArray(value)) return null
  const assignments = new Map<string, string[]>()
  for (const rawAssignment of value) {
    if (!rawAssignment || typeof rawAssignment !== 'object') continue
    const assignment = rawAssignment as Partial<StaffRoleAssignment>
    const organizationId = readUuid(assignment.organizationId)
    if (!organizationId) continue
    assignments.set(organizationId, readOrganizationIds(assignment.roleIds))
  }
  return assignments
}

export default async function handleMembershipChange(
  payload: unknown,
  ctx: SubscriberContext,
): Promise<void> {
  const input = payload && typeof payload === 'object' ? payload as MembershipChangePayload : {}
  const userId = readUuid(input.userId)
  const tenantId = readUuid(input.tenantId)
  if (!userId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')
  const organizationIds = readOrganizationIds(input.organizationIds)
  const roleAssignments = readStaffRoleAssignments(input.staffRoleAssignments)
  const members = await findWithDecryption(
    em,
    StaffTeamMember,
    { tenantId, userId, deletedAt: null },
    undefined,
    { tenantId, organizationId: null },
  )
  const membersByOrganizationId = new Map<string, StaffTeamMember>()
  for (const member of members) {
    const organizationId = String(member.organizationId)
    if (!membersByOrganizationId.has(organizationId)) membersByOrganizationId.set(organizationId, member)
  }

  const desiredOrganizations = new Set(organizationIds)
  const user = desiredOrganizations.size > 0
    ? await findOneWithDecryption(
        em,
        User,
        { id: userId, tenantId, deletedAt: null },
        undefined,
        { tenantId, organizationId: null },
      )
    : null
  if (desiredOrganizations.size > 0 && !user) return

  const validRoleIdsByOrganization = new Map<string, Set<string>>()
  if (roleAssignments) {
    const requestedRoleIds = Array.from(roleAssignments.values()).flat()
    if (requestedRoleIds.length) {
      const roles = await findWithDecryption(
        em,
        StaffTeamRole,
        {
          tenantId,
          organizationId: { $in: organizationIds },
          id: { $in: requestedRoleIds },
          deletedAt: null,
        },
        undefined,
        { tenantId, organizationId: null },
      )
      for (const role of roles) {
        const ids = validRoleIdsByOrganization.get(String(role.organizationId)) ?? new Set<string>()
        ids.add(role.id)
        validRoleIdsByOrganization.set(String(role.organizationId), ids)
      }
    }
  }

  if (user) {
    const displayName = user.name?.trim() || user.email
    for (const organizationId of desiredOrganizations) {
      const existing = membersByOrganizationId.get(organizationId)
      if (existing) {
        if (existing.isAutoProvisioned) {
          existing.isActive = true
          existing.displayName = displayName
        }
        if (roleAssignments) {
          const validRoleIds = validRoleIdsByOrganization.get(organizationId) ?? new Set<string>()
          existing.roleIds = (roleAssignments.get(organizationId) ?? []).filter((roleId) => validRoleIds.has(roleId))
        }
        continue
      }
      const validRoleIds = validRoleIdsByOrganization.get(organizationId) ?? new Set<string>()
      em.persist(em.create(StaffTeamMember, {
        tenantId,
        organizationId,
        userId,
        displayName,
        teamId: null,
        description: null,
        roleIds: roleAssignments
          ? (roleAssignments.get(organizationId) ?? []).filter((roleId) => validRoleIds.has(roleId))
          : [],
        tags: [],
        availabilityRuleSetId: null,
        isActive: true,
        isAutoProvisioned: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }))
    }
  }

  for (const member of members) {
    if (member.isAutoProvisioned && !desiredOrganizations.has(String(member.organizationId))) {
      member.isActive = false
    }
  }

  await em.flush()
}
