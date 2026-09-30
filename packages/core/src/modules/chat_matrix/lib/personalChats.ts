import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { botMxid, bridgeGhostNetwork, MatrixError, type MatrixClient } from '@open-mercato/matrix'
import type {
  ConnectorAccount,
  ConnectorChat,
  ConnectorContext,
} from '@open-mercato/core/modules/chat/lib/accountConnector'
import { ChatMatrixAccountLogin, ChatMatrixRoom } from '../data/entities'
import { clientFor, loadLoginRow, type AccountConnectorDeps } from './accounts'
import { ensureBotRegistered } from './identities'
import { externalContactIdFor, fallbackGhostName, ghostPhoneNumber, systemContext } from './outsiders'

const logger = createLogger('chat_matrix').child({ component: 'personal-chats' })

/**
 * A personal WhatsApp's chats, and moving one of them to the company.
 *
 * The bridge makes a room for every chat on an employee's number and joins
 * their own identity (`@opp_…`) to it. That identity is outside the Operis
 * appservice's namespace, so the homeserver never pushes those rooms here, and
 * the Operis bot is in none of them: nothing on a personal number reaches
 * Operis by itself.
 *
 * Listing reads the rooms live, as the employee, for names only. Moving one
 * maps it to a new client conversation owned by the employee — with the moment
 * of the move as `projectFrom`, so the projector drops everything said before
 * it — and only then invites the bot, which is what lets its events in.
 */

/** Enough for anyone's chat list, without a request per room for thousands of them. */
const MAX_LISTED_CHATS = 300
const LOOKUP_CONCURRENCY = 8

type Portal = { name: string; ghosts: Array<{ mxid: string; displayName: string }> }

function displayNameOf(info: unknown): string | null {
  const raw = info && typeof info === 'object' ? (info as { display_name?: unknown }).display_name : undefined
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
}

async function roomName(client: MatrixClient, roomId: string, asUser: string): Promise<string | null> {
  try {
    const state = await client.getStateEvent<{ name?: unknown }>(roomId, 'm.room.name', '', asUser)
    return typeof state.name === 'string' && state.name.trim().length > 0 ? state.name.trim() : null
  } catch {
    return null
  }
}

/**
 * The chat a room is, seen by the account's identity: the network's people in
 * it and what to call it. Null for a room with nobody from the network — the
 * bridge's own management room — or one the identity is not in.
 */
async function describePortal(
  deps: AccountConnectorDeps,
  client: MatrixClient,
  row: ChatMatrixAccountLogin,
  roomId: string,
): Promise<Portal | null> {
  let joined: Record<string, unknown>
  try {
    joined = (await client.joinedMembers(roomId, row.mxid)).joined ?? {}
  } catch (error) {
    if (error instanceof MatrixError && !error.isTransient) return null
    throw error
  }
  if (!(row.mxid in joined)) return null
  const ghosts = Object.entries(joined)
    .filter(([mxid]) => bridgeGhostNetwork(deps.config, mxid) === row.network)
    .map(([mxid, info]) => ({ mxid, displayName: displayNameOf(info) ?? fallbackGhostName(deps.config, mxid) }))
  if (ghosts.length === 0) return null
  const named = await roomName(client, roomId, row.mxid)
  const name = named ?? ghosts.map((ghost) => ghost.displayName).join(', ')
  return { name, ghosts }
}

async function eachLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index]!)
    }
  })
  await Promise.all(lanes)
  return results
}

/** The personal account behind a connector call, logged in — or null. */
async function personalLogin(em: EntityManager, account: ConnectorAccount): Promise<ChatMatrixAccountLogin | null> {
  if (account.ownerType !== 'user' || !account.ownerUserId) return null
  const row = await loadLoginRow(em, account)
  return row?.registeredAt && row.userLoginId ? row : null
}

export async function listPersonalChats(
  deps: AccountConnectorDeps,
  ctx: ConnectorContext,
  account: ConnectorAccount,
): Promise<ConnectorChat[]> {
  const row = await personalLogin(ctx.em, account)
  if (!row) return []
  const client = clientFor(deps, 'user')
  const rooms = ((await client.joinedRooms(row.mxid)).joined_rooms ?? []).slice(0, MAX_LISTED_CHATS)
  if (rooms.length === 0) return []

  const mapped = new Map(
    (await ctx.em.find(ChatMatrixRoom, { roomId: { $in: rooms } })).map((room) => [room.roomId, room]),
  )
  const chats = await eachLimited(rooms, LOOKUP_CONCURRENCY, async (roomId): Promise<ConnectorChat | null> => {
    const room = mapped.get(roomId)
    // Mapped to anything but this account's own move — never offered.
    if (room && room.accountId !== account.id) return null
    const portal = await describePortal(deps, client, row, roomId)
    if (!portal) return null
    return {
      id: roomId,
      name: portal.name,
      kind: portal.ghosts.length > 1 ? 'group' : 'direct',
      conversationId: room?.conversationId ?? null,
    }
  })
  return chats
    .filter((chat): chat is ConnectorChat => chat !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function movePersonalChat(
  deps: AccountConnectorDeps,
  ctx: ConnectorContext,
  account: ConnectorAccount,
  roomId: string,
): Promise<{ conversationId: string } | null> {
  const row = await personalLogin(ctx.em, account)
  if (!row || !account.ownerUserId) return null

  const existing = await ctx.em.findOne(ChatMatrixRoom, { roomId })
  if (existing) return existing.accountId === account.id ? { conversationId: existing.conversationId } : null

  const client = clientFor(deps, 'user')
  const portal = await describePortal(deps, client, row, roomId)
  if (!portal) return null

  const scope = account.scope
  const container = ctx.container as CommandRuntimeContext['container']
  const commandBus = container.resolve('commandBus') as CommandBus
  const system = systemContext({ container }, scope)

  const externalContactIds: string[] = []
  for (const ghost of portal.ghosts) {
    const id = externalContactIdFor(scope, ghost.mxid)
    await commandBus.execute('chat.externalContacts.ensure', {
      input: {
        ...scope,
        id,
        network: row.network,
        displayName: ghost.displayName,
        handle: ghostPhoneNumber(deps.config, ghost.mxid) ?? undefined,
      },
      ctx: system,
    })
    externalContactIds.push(id)
  }

  const created = await commandBus.execute<Record<string, unknown>, { conversationId: string }>(
    'chat.conversations.createExternal',
    {
      input: {
        ...scope,
        title: portal.ghosts.length > 1 ? portal.name : null,
        externalContactIds,
        memberUserIds: [account.ownerUserId],
        messagingAccountId: account.id,
      },
      ctx: system,
    },
  )
  const conversationId = created.result?.conversationId
  if (!conversationId) throw new Error('[internal] chat.conversations.createExternal returned no conversation')

  // Mapped before the bot is let in, so the first event it brings already
  // finds the room — and the moment it was moved.
  const now = new Date()
  const em = ctx.em.fork()
  em.persist(
    em.create(ChatMatrixRoom, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      conversationId,
      roomId,
      state: 'ready',
      lastError: null,
      accountId: account.id,
      projectFrom: now,
      createdAt: now,
      updatedAt: now,
    }),
  )
  try {
    await em.flush()
  } catch (error) {
    // Moved twice at once. Close ours; the winner's is the conversation.
    await commandBus.execute('chat.conversations.closeExternal', { input: { ...scope, conversationId }, ctx: system })
    if (!isUniqueViolation(error)) throw error
    const winner = await ctx.em.fork().findOne(ChatMatrixRoom, { roomId })
    return winner && winner.accountId === account.id ? { conversationId: winner.conversationId } : null
  }

  const bot = botMxid(deps.config)
  try {
    await ensureBotRegistered(deps)
    await client.invite(roomId, bot, row.mxid).catch((error: unknown) => {
      // Refused when the bot is already in, from an earlier attempt; the join
      // below says whether it really is.
      if (!(error instanceof MatrixError) || error.errcode !== 'M_FORBIDDEN') throw error
    })
    await deps.client.join(roomId, bot)
  } catch (error) {
    // Without the bot nothing said in the chat would ever arrive: undo the
    // move rather than leave a conversation that stays silent.
    await ctx.em.fork().nativeDelete(ChatMatrixRoom, { roomId, conversationId })
    await commandBus.execute('chat.conversations.closeExternal', { input: { ...scope, conversationId }, ctx: system })
    throw error
  }

  logger.info('moved a personal chat to the company', { conversationId, accountId: account.id })
  return { conversationId }
}
