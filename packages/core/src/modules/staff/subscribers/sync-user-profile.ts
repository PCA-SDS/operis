import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTeamMember } from '../data/entities'

export const metadata = {
  event: 'auth.user.updated',
  persistent: true,
  id: 'staff:sync-user-profile',
}

type UserUpdatedPayload = {
  id?: unknown
  tenantId?: unknown
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

export default async function handleUserUpdated(
  payload: unknown,
  ctx: SubscriberContext,
): Promise<void> {
  const input = payload && typeof payload === 'object' ? payload as UserUpdatedPayload : {}
  const userId = readUuid(input.id)
  const tenantId = readUuid(input.tenantId)
  if (!userId || !tenantId) return

  const em = ctx.resolve<EntityManager>('em')
  const user = await findOneWithDecryption(
    em,
    User,
    { id: userId, tenantId, deletedAt: null },
    undefined,
    { tenantId, organizationId: null },
  )
  if (!user) return

  const displayName = user.name?.trim() || user.email
  const members = await findWithDecryption(
    em,
    StaffTeamMember,
    { tenantId, userId, isAutoProvisioned: true, deletedAt: null },
    undefined,
    { tenantId, organizationId: null },
  )
  let changed = false
  for (const member of members) {
    if (member.displayName !== displayName) {
      member.displayName = displayName
      changed = true
    }
  }
  if (changed) await em.flush()
}
