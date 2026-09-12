import type { EntityManager } from '@mikro-orm/postgresql'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { botMxid, MatrixError, type MatrixClient, type MatrixConfig } from '@open-mercato/matrix'
import { ChatMatrixRoom } from '../data/entities'
import { ensureIdentity, type IdentityDeps } from './identities'

const logger = createLogger('chat_matrix').child({ component: 'rooms' })

/**
 * Power levels mirroring the Operis role model.
 *
 * The bot is room admin at 100, an Operis space owner is 50 and a member is 0,
 * so the homeserver enforces the same rule Operis does. That matters once a
 * bridge or a native client can also write into the room — at that point Operis
 * is no longer the only thing deciding who may do what.
 */
const POWER_BOT = 100
const POWER_OWNER = 50
const POWER_MEMBER = 0

export type RoomDeps = IdentityDeps & {
  em: EntityManager
  client: MatrixClient
  config: MatrixConfig
}

export type EnsureRoomInput = {
  conversationId: string
  kind: 'direct' | 'space'
  title: string | null
  memberUserIds: string[]
  ownerUserIds: string[]
}

export type RoomScope = {
  tenantId: string
  organizationId: string
}

/**
 * The Matrix room backing a conversation, creating it if this is the first use.
 *
 * The room is created **by the bot, not by a member**. Two reasons, and the
 * first is a hard constraint: the creator must hold power level 100 while the
 * room's own state events are written, so a room created as an Operis owner and
 * immediately demoted to 50 fails with `user_level (50) < send_level (100)`.
 * The second is design — Operis is the authority over the conversation, and a
 * room must not be orphaned when the person who started it leaves.
 */
export async function ensureRoom(
  deps: RoomDeps,
  scope: RoomScope,
  input: EnsureRoomInput,
): Promise<string> {
  const existing = await deps.em.findOne(ChatMatrixRoom, {
    conversationId: input.conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existing?.state === 'ready') return existing.roomId
  if (existing) {
    // A previous attempt got as far as a row. Finish it rather than making a
    // second room — `chat_matrix_rooms_conversation_uq` would refuse that anyway,
    // and refusing is the right answer.
    return finishProvisioning(deps, scope, input, existing)
  }

  const bot = botMxid(deps.config)
  const memberMxids = await resolveMembers(deps, scope.tenantId, input)

  const room = await deps.client.createRoom(
    {
      preset: input.kind === 'direct' ? 'trusted_private_chat' : 'private_chat',
      name: input.title ?? undefined,
      isDirect: input.kind === 'direct',
      powerLevels: {
        users: {
          [bot]: POWER_BOT,
          ...Object.fromEntries(
            input.ownerUserIds
              .map((userId) => memberMxids.get(userId))
              .filter((mxid): mxid is string => Boolean(mxid))
              .map((mxid) => [mxid, POWER_OWNER]),
          ),
        },
        users_default: POWER_MEMBER,
        events_default: POWER_MEMBER,
        state_default: POWER_OWNER,
        invite: POWER_OWNER,
        kick: POWER_OWNER,
        ban: POWER_OWNER,
        redact: POWER_OWNER,
      },
    },
    bot,
  )

  const record = deps.em.create(ChatMatrixRoom, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    conversationId: input.conversationId,
    roomId: room.room_id,
    state: 'pending',
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  deps.em.persist(record)

  try {
    await deps.em.flush()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Two senders raced into the same fresh conversation. The loser's room is
    // now an orphan on the homeserver — logged rather than deleted, because
    // deleting it is a second failure mode and an empty private room costs
    // nothing. The winner is what everything reads.
    logger.warn('lost a room-creation race; the room just created is orphaned', {
      conversationId: input.conversationId,
      orphanedRoomId: room.room_id,
    })
    const winner = await deps.em.fork().findOne(ChatMatrixRoom, {
      conversationId: input.conversationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!winner) throw error
    return winner.roomId
  }

  return finishProvisioning(deps, scope, input, record)
}

/**
 * Invite and join everyone, then mark the room usable.
 *
 * Separate from creation because it is the part that can fail halfway and be
 * resumed. `state` stays `pending` until every member is in, so a send never
 * lands in a room that half the conversation cannot read.
 */
async function finishProvisioning(
  deps: RoomDeps,
  scope: RoomScope,
  input: EnsureRoomInput,
  record: ChatMatrixRoom,
): Promise<string> {
  const bot = botMxid(deps.config)
  try {
    const memberMxids = await resolveMembers(deps, scope.tenantId, input)
    const joined = await deps.client.joinedMembers(record.roomId, bot)

    for (const [, mxid] of memberMxids) {
      if (joined.joined[mxid]) continue
      await inviteAndJoin(deps, record.roomId, bot, mxid)
    }

    record.state = 'ready'
    record.lastError = null
    await deps.em.flush()
    return record.roomId
  } catch (error) {
    record.state = 'failed'
    record.lastError = error instanceof Error ? error.message : String(error)
    await deps.em.flush()
    throw error
  }
}

async function inviteAndJoin(
  deps: RoomDeps,
  roomId: string,
  bot: string,
  mxid: string,
): Promise<void> {
  try {
    await deps.client.invite(roomId, mxid, bot)
  } catch (error) {
    // Already invited, or already in. Both mean the invite did its job; only a
    // different failure is worth propagating.
    if (!(error instanceof MatrixError) || error.errcode !== 'M_FORBIDDEN') throw error
  }
  await deps.client.join(roomId, mxid)
}

async function resolveMembers(
  deps: RoomDeps,
  tenantId: string,
  input: EnsureRoomInput,
): Promise<Map<string, string>> {
  const byUserId = new Map<string, string>()
  for (const userId of input.memberUserIds) {
    byUserId.set(userId, await ensureIdentity(deps, tenantId, userId))
  }
  return byUserId
}

/** Add one person to a room that already exists. */
export async function addRoomMember(
  deps: RoomDeps,
  tenantId: string,
  roomId: string,
  userId: string,
): Promise<void> {
  const mxid = await ensureIdentity(deps, tenantId, userId)
  await inviteAndJoin(deps, roomId, botMxid(deps.config), mxid)
}

/**
 * Send as a room member, putting them in the room first if they are not.
 *
 * Both send paths need this and for the same reason, from two directions:
 *
 * - **Live**: `ensureRoom` returns early for a room that is already `ready` and
 *   never revisits membership, so somebody added to an Operis space after its
 *   room was built has no Matrix membership.
 * - **Backfill**: a room is provisioned from the CURRENT participants, but its
 *   history was written by people who have since left. Their messages are still
 *   in the transcript and still have to go somewhere.
 *
 * Reconciling the whole roster before every send would cost a round trip per
 * message to catch a once-per-person case. Repairing on the refusal costs
 * nothing on the happy path and fixes membership drift from any cause.
 *
 * Bounded to one retry: if joining did not help, the refusal is about something
 * else and must surface.
 */
export async function sendAsRoomMember(
  deps: RoomDeps,
  tenantId: string,
  params: {
    roomId: string
    eventType: string
    transactionId: string
    content: Record<string, unknown>
    userId: string
    asUser: string
  },
): Promise<{ event_id: string }> {
  return asRoomMember(deps, tenantId, params, () =>
    deps.client.sendEvent({
      roomId: params.roomId,
      eventType: params.eventType,
      transactionId: params.transactionId,
      content: params.content,
      asUser: params.asUser,
    }),
  )
}

/**
 * Redact as a room member, putting them in the room first if they are not.
 *
 * Same self-heal as {@link sendAsRoomMember} and for the same reason. Note the
 * redaction is performed as the ACTOR rather than as the bot: the author may
 * always redact their own event, and a space owner sits at power level 50, which
 * is the room's `redact` level — so the homeserver enforces the same rule Operis
 * does, and the room records who removed the message rather than attributing
 * every deletion to the service account.
 */
export async function redactAsRoomMember(
  deps: RoomDeps,
  tenantId: string,
  params: {
    roomId: string
    eventId: string
    transactionId: string
    userId: string
    asUser: string
    reason?: string
  },
): Promise<{ event_id: string }> {
  return asRoomMember(deps, tenantId, params, () =>
    deps.client.redact({
      roomId: params.roomId,
      eventId: params.eventId,
      transactionId: params.transactionId,
      asUser: params.asUser,
      reason: params.reason,
    }),
  )
}

async function asRoomMember<T>(
  deps: RoomDeps,
  tenantId: string,
  params: { roomId: string; userId: string },
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (!(error instanceof MatrixError) || error.errcode !== 'M_FORBIDDEN') throw error
    logger.info('actor was not in the room; joining and retrying once', {
      roomId: params.roomId,
      userId: params.userId,
    })
    await addRoomMember(deps, tenantId, params.roomId, params.userId)
    return action()
  }
}
