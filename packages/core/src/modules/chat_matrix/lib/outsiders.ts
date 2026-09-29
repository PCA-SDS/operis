import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createHash } from 'node:crypto'
import { botMxid, bridgeGhostNetwork, operisUserIdFromMxid, parseMxid, type MatrixClient, type MatrixConfig } from '@open-mercato/matrix'
import type { ChatActor } from '@open-mercato/core/modules/chat/lib/participants'
import type { ChatScope } from '@open-mercato/core/modules/chat/lib/scope'
import type { ChatMatrixRoom } from '../data/entities'

const logger = createLogger('chat_matrix').child({ component: 'outsiders' })

/**
 * Who a Matrix sender is to chat — the projector's decision table.
 *
 * | Sender                                   | Conversation | Result                      |
 * |------------------------------------------|--------------|-----------------------------|
 * | an Operis identity                       | any          | a colleague                 |
 * | a configured bridge ghost                | external     | an outsider (found/created) |
 * | a configured bridge ghost                | direct/space | skip: external-in-internal-room |
 * | anyone else (bots, unconfigured senders) | any          | skip: external-sender       |
 *
 * A ghost's mxid carries its phone number or handle, so none of this ever logs
 * one above debug level.
 */

export type OutsiderDeps = {
  em: EntityManager
  commandBus: CommandBus
  config: MatrixConfig
  container: CommandRuntimeContext['container']
  client: MatrixClient
}

export type ActorResolution =
  | { ok: true; actor: ChatActor }
  | { ok: false; reason: 'external-sender' | 'external-in-internal-room' | 'unmapped-room' }

/**
 * The contact id for a ghost in an organization — deterministic, so push and
 * poll projecting the same newcomer at once converge on one row, and the mxid
 * never has to be stored to find it again.
 *
 * **The key format is a one-way door.** Changing it makes every outsider new:
 * their past messages would stay attributed to contacts nobody resolves to.
 */
export function externalContactIdFor(scope: ChatScope, mxid: string): string {
  return uuidV8FromKey(`chat:external-contact:${scope.tenantId}:${scope.organizationId}:${mxid}`)
}

/**
 * An RFC 9562 UUIDv8 — the version reserved for custom layouts — whose custom
 * bits are the SHA-256 of the key. Deterministic, like `stableUuidFromKey`, but
 * a valid UUID: that helper yields a hash shaped like one, which strict
 * validators such as zod's `.uuid()` refuse, and a contact id reaches API
 * responses and command inputs.
 */
function uuidV8FromKey(key: string): string {
  const nibbles = createHash('sha256').update(key).digest('hex').slice(0, 32).split('')
  nibbles[12] = '8'
  nibbles[16] = ((parseInt(nibbles[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const hex = nibbles.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** A command context for work nobody is logged in to do: no `sub` at all. */
export function systemContext(
  deps: Pick<OutsiderDeps, 'container'>,
  scope: ChatScope,
): CommandRuntimeContext {
  return {
    container: deps.container,
    auth: {
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

/** The command context an actor replays under: a colleague's session, or none. */
export function actorContext(
  deps: Pick<OutsiderDeps, 'container'>,
  scope: ChatScope,
  actor: ChatActor,
): CommandRuntimeContext {
  if (actor.kind === 'external') return systemContext(deps, scope)
  return {
    container: deps.container,
    auth: {
      sub: actor.userId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

/** An `externalOrigin` naming the outsider when the actor is one. */
export function withActorOrigin<T extends Record<string, unknown>>(
  origin: T,
  actor: ChatActor,
): T & { externalContactId?: string } {
  return actor.kind === 'external' ? { ...origin, externalContactId: actor.externalContactId } : origin
}

/**
 * The reactor segment of a reaction's subject key. A colleague keeps the user
 * id the key always carried; an outsider is prefixed, so the two can never
 * collide — a uuid never starts with `ext-`.
 */
export function actorKey(actor: ChatActor): string {
  return actor.kind === 'user' ? actor.userId : `ext-${actor.externalContactId}`
}

async function conversationKind(em: EntityManager, room: ChatMatrixRoom): Promise<string | null> {
  const rows = await em.getConnection().execute<Array<{ kind: string }>>(
    `select kind from chat_conversations
      where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null`,
    [room.conversationId, room.tenantId, room.organizationId],
  )
  return rows[0]?.kind ?? null
}

const GHOST_NAME_TTL_MS = 5 * 60_000
const GHOST_NAME_CACHE_LIMIT = 1_000
const ghostNames = new Map<string, { name: string | null; at: number }>()

/**
 * The name a bridge gave its ghost in this room, or null.
 *
 * Cached briefly: a busy group would otherwise cost a homeserver round trip per
 * message, and a name that changed reaches the contact within minutes anyway.
 */
async function ghostDisplayName(deps: OutsiderDeps, roomId: string, mxid: string): Promise<string | null> {
  const key = `${roomId}|${mxid}`
  const cached = ghostNames.get(key)
  if (cached && Date.now() - cached.at < GHOST_NAME_TTL_MS) return cached.name

  let name: string | null = null
  try {
    const members = await deps.client.joinedMembers(roomId, botMxid(deps.config))
    const info = members.joined?.[mxid]
    const raw = info && typeof info === 'object' ? (info as { display_name?: unknown }).display_name : undefined
    name = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  } catch (error) {
    logger.warn('could not read a bridged sender name', {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  if (ghostNames.size >= GHOST_NAME_CACHE_LIMIT) {
    const oldest = ghostNames.keys().next().value
    if (oldest !== undefined) ghostNames.delete(oldest)
  }
  ghostNames.set(key, { name, at: Date.now() })
  return name
}

/** What to call a ghost the bridge gave no name: its localpart, without the bridge prefix. */
export function fallbackGhostName(config: MatrixConfig, mxid: string): string {
  const localpart = parseMxid(mxid)?.localpart ?? mxid
  const ghost = (config.bridgeGhosts ?? []).find((candidate) => localpart.startsWith(candidate.prefix))
  return ghost ? localpart.slice(ghost.prefix.length) : localpart
}

/**
 * Resolve an event's sender to a chat actor, seating an outsider on the way.
 *
 * For a ghost in an external conversation this ensures the contact — creating
 * it or refreshing its name — and ensures they are a participant, each through
 * the chat command that owns the rule and each idempotent. A failure part-way
 * leaves at most a contact or a participant row that the retry reuses.
 */
export async function resolveProjectionActor(
  deps: OutsiderDeps,
  sender: string,
  room: ChatMatrixRoom,
): Promise<ActorResolution> {
  const userId = operisUserIdFromMxid(deps.config, sender)
  if (userId) return { ok: true, actor: { kind: 'user', userId } }

  const network = bridgeGhostNetwork(deps.config, sender)
  if (!network) {
    logger.debug('skipping an event from a non-Operis sender', { roomId: room.roomId })
    return { ok: false, reason: 'external-sender' }
  }

  const kind = await conversationKind(deps.em, room)
  if (kind === null) return { ok: false, reason: 'unmapped-room' }
  if (kind !== 'external') {
    // Should be impossible: Operis never invites a ghost into a room it owns.
    // Loud, because if it happens something upstream is wrong.
    logger.warn('a bridge ghost spoke in an internal conversation; not projected', {
      roomId: room.roomId,
      conversationId: room.conversationId,
      network,
    })
    return { ok: false, reason: 'external-in-internal-room' }
  }

  const scope: ChatScope = { tenantId: room.tenantId, organizationId: room.organizationId }
  const externalContactId = externalContactIdFor(scope, sender)
  const displayName = (await ghostDisplayName(deps, room.roomId, sender)) ?? fallbackGhostName(deps.config, sender)
  const ctx = systemContext(deps, scope)

  await deps.commandBus.execute('chat.externalContacts.ensure', {
    input: { ...scope, id: externalContactId, network, displayName },
    ctx,
  })
  await deps.commandBus.execute('chat.conversations.addExternalParticipant', {
    input: { ...scope, conversationId: room.conversationId, externalContactId },
    ctx,
  })
  return { ok: true, actor: { kind: 'external', externalContactId } }
}

/**
 * The reader behind a receipt, without seating anyone: a receipt is not a
 * reason to add a person to a conversation. An outsider who is not a
 * participant simply matches no row, and the receipt is dropped.
 */
export function receiptActor(config: MatrixConfig, scope: ChatScope, reader: string): ChatActor | null {
  const userId = operisUserIdFromMxid(config, reader)
  if (userId) return { kind: 'user', userId }
  if (bridgeGhostNetwork(config, reader)) {
    return { kind: 'external', externalContactId: externalContactIdFor(scope, reader) }
  }
  return null
}
