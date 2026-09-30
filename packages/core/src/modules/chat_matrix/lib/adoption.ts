import { createLogger } from '@open-mercato/shared/lib/logger'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import {
  accountFromMxid,
  botMxid,
  bridgeGhostNetwork,
  MatrixError,
  type MatrixEvent,
} from '@open-mercato/matrix'
import type { ChatScope } from '@open-mercato/core/modules/chat/lib/scope'
import { ChatMatrixAccountLogin, ChatMatrixRoom } from '../data/entities'
import { externalContactIdFor, fallbackGhostName, ghostPhoneNumber, systemContext, type OutsiderDeps } from './outsiders'
import { ensureBotRegistered } from './identities'

const logger = createLogger('chat_matrix').child({ component: 'adoption' })

/**
 * Turning a company account's WhatsApp chat into an Operis conversation.
 *
 * The bridge makes a room — a portal — for every chat on a connected number
 * and joins the account's identity to it. That identity is in the Operis
 * appservice's namespace, so the homeserver pushes the portal's events here.
 * The first one for a room Operis has never seen triggers adoption:
 *
 * 1. every bridge ghost in the room becomes a contact;
 * 2. an external conversation is opened for the account's team (chat decides
 *    who, and starts their read cursors where the account connected, so the
 *    imported history does not ring anybody's bell);
 * 3. the room is mapped to it, with the account, so replies leave from that
 *    number.
 *
 * A personal account's portals are never pushed here — its identity is outside
 * the namespace — so nothing in this file can adopt one.
 */

/** How long to remember that a room is nobody's portal, so a busy stranger room costs one probe, not one per event. */
const NOT_A_PORTAL_TTL_MS = 5 * 60_000
const NOT_A_PORTAL_LIMIT = 2_000
const notAPortal = new Map<string, number>()

function rememberNotAPortal(roomId: string): void {
  if (notAPortal.size >= NOT_A_PORTAL_LIMIT) {
    const oldest = notAPortal.keys().next().value
    if (oldest !== undefined) notAPortal.delete(oldest)
  }
  notAPortal.set(roomId, Date.now() + NOT_A_PORTAL_TTL_MS)
}

function knownNotAPortal(roomId: string): boolean {
  const until = notAPortal.get(roomId)
  if (until === undefined) return false
  if (until > Date.now()) return true
  notAPortal.delete(roomId)
  return false
}

/** Test seam: forget what has been learned about rooms. */
export function resetAdoptionCache(): void {
  notAPortal.clear()
}

/**
 * The company account identity a membership event is about, when it is one
 * joining or being invited — the moment a new portal announces itself.
 */
export function adoptionHint(deps: Pick<OutsiderDeps, 'config'>, event: MatrixEvent): string | null {
  if (event.type !== 'm.room.member' || !event.state_key) return null
  const membership = event.content.membership
  if (membership !== 'join' && membership !== 'invite') return null
  const account = accountFromMxid(deps.config, event.state_key)
  return account?.owner === 'company' ? event.state_key : null
}

/**
 * The room's mapping, adopting it first when it is a connected company
 * account's portal. Null when it is not one.
 *
 * `accountMxid` names the identity when the caller already knows it (a
 * membership event); otherwise every connected company identity is asked
 * whether it is in the room.
 */
export async function adoptPortal(
  deps: OutsiderDeps,
  roomId: string,
  accountMxid?: string | null,
): Promise<ChatMatrixRoom | null> {
  const mapped = await deps.em.findOne(ChatMatrixRoom, { roomId })
  if (mapped) return mapped
  if (!accountMxid && knownNotAPortal(roomId)) return null

  const found = await findPortalOwner(deps, roomId, accountMxid ?? null)
  if (!found) {
    rememberNotAPortal(roomId)
    return null
  }
  const { login, joined } = found
  const scope: ChatScope = { tenantId: login.tenantId, organizationId: login.organizationId }

  const ghosts = Object.keys(joined).filter(
    (userId) => bridgeGhostNetwork(deps.config, userId) === login.network,
  )
  if (ghosts.length === 0) {
    // The bridge's management room, or a room nobody outside is in yet. Not a
    // customer chat; a later event re-checks once somebody arrives.
    rememberNotAPortal(roomId)
    return null
  }

  const ctx = systemContext(deps, scope)
  const externalContactIds: string[] = []
  for (const ghost of ghosts) {
    const id = externalContactIdFor(scope, ghost)
    const info = joined[ghost]
    const raw = info && typeof info === 'object' ? (info as { display_name?: unknown }).display_name : undefined
    const displayName = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallbackGhostName(deps.config, ghost)
    await deps.commandBus.execute('chat.externalContacts.ensure', {
      input: { ...scope, id, network: login.network, displayName, handle: ghostPhoneNumber(deps.config, ghost) ?? undefined },
      ctx,
    })
    externalContactIds.push(id)
  }

  // A one-to-one chat is named after its contact at read time; a group keeps
  // the name WhatsApp gave it.
  const title = ghosts.length > 1 ? await roomName(deps, roomId, login.mxid) : null

  const created = await deps.commandBus.execute<Record<string, unknown>, { conversationId: string }>(
    'chat.conversations.createExternal',
    {
      input: { ...scope, title, externalContactIds, memberUserIds: [], messagingAccountId: login.accountId },
      ctx,
    },
  )
  const conversationId = created.result?.conversationId
  if (!conversationId) throw new Error('[internal] chat.conversations.createExternal returned no conversation')

  const room = deps.em.create(ChatMatrixRoom, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    conversationId,
    roomId,
    state: 'ready',
    lastError: null,
    accountId: login.accountId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  deps.em.persist(room)
  try {
    await deps.em.flush()
  } catch (error) {
    // Adopted concurrently — push and a lazy probe at once. Close ours; the
    // winner's mapping is what every later event reads.
    deps.em.clear()
    await deps.commandBus.execute('chat.conversations.closeExternal', { input: { ...scope, conversationId }, ctx })
    if (!isUniqueViolation(error)) throw error
    return deps.em.fork().findOne(ChatMatrixRoom, { roomId })
  }

  logger.info('adopted a messaging account chat', {
    conversationId,
    accountId: login.accountId,
    contacts: externalContactIds.length,
  })

  await inviteBot(deps, roomId, login.mxid)
  return room
}

/**
 * The connected company account whose identity is in the room, with the
 * room's members as that identity sees them.
 */
async function findPortalOwner(
  deps: OutsiderDeps,
  roomId: string,
  accountMxid: string | null,
): Promise<{ login: ChatMatrixAccountLogin; joined: Record<string, unknown> } | null> {
  const candidates = accountMxid
    ? await deps.em.find(ChatMatrixAccountLogin, { mxid: accountMxid, ownerType: 'company' })
    : await deps.em.find(ChatMatrixAccountLogin, { ownerType: 'company', registeredAt: { $ne: null } })

  for (const login of candidates) {
    let joined: Record<string, unknown>
    try {
      joined = (await deps.client.joinedMembers(roomId, login.mxid)).joined ?? {}
    } catch (error) {
      if (!(error instanceof MatrixError) || error.isTransient) throw error
      // Invited but not joined yet: accept on the account's behalf. The bridge
      // double-puppets invites itself; this covers the case where it did not.
      if (accountMxid === login.mxid) {
        try {
          await deps.client.join(roomId, login.mxid)
          joined = (await deps.client.joinedMembers(roomId, login.mxid)).joined ?? {}
        } catch (joinError) {
          if (joinError instanceof MatrixError && joinError.isTransient) throw joinError
          continue
        }
      } else {
        continue
      }
    }
    if (login.mxid in joined) return { login, joined }
  }
  return null
}

async function roomName(deps: OutsiderDeps, roomId: string, asUser: string): Promise<string | null> {
  try {
    const state = await deps.client.getStateEvent<{ name?: unknown }>(roomId, 'm.room.name', '', asUser)
    return typeof state.name === 'string' && state.name.trim().length > 0 ? state.name.trim() : null
  } catch {
    return null
  }
}

/**
 * Bring the Operis bot into the portal, so the `/sync` reader — which reads as
 * the bot — covers it too, and a push lost while Operis was down is still
 * found. Best effort: a portal whose power levels refuse the invite is still
 * served by push.
 */
async function inviteBot(deps: OutsiderDeps, roomId: string, accountMxid: string): Promise<void> {
  const bot = botMxid(deps.config)
  try {
    await ensureBotRegistered(deps)
    await deps.client.invite(roomId, bot, accountMxid)
  } catch (error) {
    if (!(error instanceof MatrixError) || error.errcode !== 'M_FORBIDDEN') {
      logger.debug('could not invite the bot into an adopted chat', {
        roomId,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
  }
  try {
    await deps.client.join(roomId, bot)
  } catch (error) {
    logger.debug('the bot could not join an adopted chat', {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
