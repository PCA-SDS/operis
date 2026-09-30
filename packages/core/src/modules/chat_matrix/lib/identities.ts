import type { EntityManager } from '@mikro-orm/postgresql'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { localpartForUser, mxidForUser, type MatrixClient, type MatrixConfig } from '@open-mercato/matrix'
import { ChatMatrixIdentity } from '../data/entities'

/**
 * Operis users, as Matrix accounts.
 *
 * An Operis user has no Matrix password and never logs in to the homeserver:
 * the appservice acts as them, inside a namespace no real signup can occupy.
 * "Provisioning an identity" therefore means two things only — telling the
 * homeserver the account exists, and remembering that we did.
 */

export type IdentityDeps = {
  em: EntityManager
  client: MatrixClient
  config: MatrixConfig
}

/**
 * The Matrix id for an Operis user, creating the account if this is its first use.
 *
 * Idempotent twice over: the row is looked up before anything happens, and a
 * concurrent creator is resolved by re-reading after the unique constraint
 * rejects the loser. `registerUser` itself treats "already registered" as
 * success, so a row lost without the account being lost still converges.
 */
export async function ensureIdentity(
  deps: IdentityDeps,
  tenantId: string,
  userId: string,
  displayName?: string,
): Promise<string> {
  const existing = await deps.em.findOne(ChatMatrixIdentity, { tenantId, userId })
  if (existing) {
    await refreshDisplayName(deps, existing, displayName)
    return existing.mxid
  }

  const mxid = mxidForUser(deps.config, userId)

  // Before the row, so a row can never claim an account the homeserver does not
  // have. The reverse order would leave a mapping that every later send trusts
  // and every later send fails on.
  await deps.client.registerUser(localpartForUser(deps.config, userId))
  if (displayName) await deps.client.setDisplayName(mxid, displayName)

  const identity = deps.em.create(ChatMatrixIdentity, {
    tenantId,
    userId,
    mxid,
    registeredAt: new Date(),
    displayName: displayName ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  deps.em.persist(identity)

  try {
    await deps.em.flush()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Someone else registered the same person between our lookup and our write.
    // Both derived the same mxid — the derivation is a pure function of the user
    // id — so the winner's row is as good as ours.
    const winner = await deps.em.fork().findOne(ChatMatrixIdentity, { tenantId, userId })
    if (!winner) throw error
    return winner.mxid
  }
  return mxid
}

/**
 * Push a changed display name to the homeserver.
 *
 * Best-effort: a name that fails to update is cosmetic, and failing a send over
 * it would trade a working message for a correct label. The stored value is
 * only advanced once the homeserver has accepted it, so the next send retries.
 */
async function refreshDisplayName(
  deps: IdentityDeps,
  identity: ChatMatrixIdentity,
  displayName?: string,
): Promise<void> {
  if (!displayName || identity.displayName === displayName) return
  await deps.client.setDisplayName(identity.mxid, displayName)
  identity.displayName = displayName
  await deps.em.flush()
}

/** Provision several identities, in order — the homeserver rate-limits bursts. */
export async function ensureIdentities(
  deps: IdentityDeps,
  tenantId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const byUserId = new Map<string, string>()
  for (const userId of userIds) {
    byUserId.set(userId, await ensureIdentity(deps, tenantId, userId))
  }
  return byUserId
}

const botRegistrations = new Map<string, Promise<void>>()

/**
 * Tell the homeserver the bot exists — once per process, and again after a
 * failure.
 *
 * The bot creates every Operis room and is the identity `/sync` reads as, but an
 * appservice user is never implicit: until it is registered, both fail with
 * "Application service has not registered this user". Nothing else registers
 * it — a fresh homeserver would otherwise refuse every room Operis asks for.
 * `registerUser` treats "already registered" as success, so this is free after
 * the first call.
 */
export async function ensureBotRegistered(deps: { client: MatrixClient; config: MatrixConfig }): Promise<void> {
  const key = `${deps.config.baseUrl}|${deps.config.serverName}|${deps.config.botLocalpart}`
  let pending = botRegistrations.get(key)
  if (!pending) {
    pending = deps.client.registerUser(deps.config.botLocalpart).catch((error: unknown) => {
      botRegistrations.delete(key)
      throw error
    })
    botRegistrations.set(key, pending)
  }
  await pending
}

/** Test seam: forget which bots this process has registered. */
export function resetBotRegistrations(): void {
  botRegistrations.clear()
}
