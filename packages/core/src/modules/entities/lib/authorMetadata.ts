import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'

type AuthorLookupContext = {
  container: { resolve: (name: string) => unknown }
  auth?: { tenantId?: string | null } | null
  selectedOrganizationId?: string | null
}

function readAuthorUserId(record: Record<string, unknown>): string | null {
  return typeof record.author_user_id === 'string'
    ? record.author_user_id
    : typeof record.authorUserId === 'string'
      ? record.authorUserId
      : null
}

/**
 * Adds `authorName`/`authorEmail` (and the snake_case pair when absent) to list
 * items that carry an author user id. Rejects when the user lookup fails, so the
 * caller decides how to log it.
 */
export async function attachAuthorMetadata(items: unknown[], ctx: AuthorLookupContext): Promise<void> {
  const userIds = new Set<string>()
  items.forEach((item: unknown) => {
    if (!item || typeof item !== 'object') return
    const userId = readAuthorUserId(item as Record<string, unknown>)
    if (userId) userIds.add(userId)
  })
  if (!userIds.size) return
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const users = await findWithDecryption(
    em,
    User,
    { id: { $in: Array.from(userIds) } },
    undefined,
    { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
  )
  const map = new Map<string, { name: string | null; email: string | null }>()
  users.forEach((user) => {
    const name = typeof user.name === 'string' && user.name.trim().length
      ? user.name.trim()
      : null
    map.set(user.id, { name, email: user.email ?? null })
  })
  items.forEach((item: unknown) => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    const userId = readAuthorUserId(record)
    if (!userId) return
    const meta = map.get(userId)
    if (!meta) return
    record.authorName = meta.name
    record.authorEmail = meta.email
    if (!('author_name' in record)) record.author_name = meta.name
    if (!('author_email' in record)) record.author_email = meta.email
  })
}
