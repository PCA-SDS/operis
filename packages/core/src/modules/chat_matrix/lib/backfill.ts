import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { deriveTransactionId, type MatrixClient, type MatrixConfig } from '@open-mercato/matrix'
import { ChatMatrixEvent } from '../data/entities'
import { ensureIdentity } from './identities'
import { ensureRoom, sendAsRoomMember, type RoomDeps } from './rooms'

const logger = createLogger('chat_matrix').child({ component: 'backfill' })

/**
 * Bring the homeserver up to date with conversations that predate the transport,
 * and re-publish anything a live send failed to deliver.
 *
 * Resumable by construction rather than by bookkeeping: the work queue *is* the
 * set of messages with no `chat_matrix_events` row. A run that dies halfway has
 * less to do next time and no state to reconcile, and two runs at once cannot
 * duplicate anything — every publish carries a transaction id derived from the
 * Operis message id, so a message the homeserver already has resolves to the
 * original event rather than a second copy.
 */

/** Small enough that one batch never holds a long transaction. */
const CONVERSATION_BATCH = 25

export type BackfillDeps = {
  em: EntityManager
  client: MatrixClient
  config: MatrixConfig
}

export type BackfillProgress = {
  conversationId: string
  roomsCreated: number
  messagesPublished: number
  messagesFailed: number
}

export type BackfillOptions = {
  tenantId?: string
  organizationId?: string
  /** Cap the number of conversations touched in one run. */
  limit?: number
  dryRun?: boolean
  onProgress?: (progress: BackfillProgress) => void
}

export type BackfillResult = {
  conversationsProcessed: number
  roomsCreated: number
  messagesPublished: number
  messagesFailed: number
}

type PendingConversation = {
  conversation_id: string
  tenant_id: string
  organization_id: string
  kind: 'direct' | 'space'
  title: string | null
  pending: string
}

type PendingMessage = {
  id: string
  sender_user_id: string
  body: string
  created_at: Date
  reply_to_message_id: string | null
}

export async function backfillConversations(
  deps: BackfillDeps,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const connection = deps.em.getConnection()
  const result: BackfillResult = {
    conversationsProcessed: 0,
    roomsCreated: 0,
    messagesPublished: 0,
    messagesFailed: 0,
  }

  const params: unknown[] = []
  const filters: string[] = []
  if (options.tenantId) {
    params.push(options.tenantId)
    filters.push('c.tenant_id = ?')
  }
  if (options.organizationId) {
    params.push(options.organizationId)
    filters.push('c.organization_id = ?')
  }
  params.push(Math.min(Math.max(options.limit ?? CONVERSATION_BATCH, 1), 1000))
  const scoped = filters.length ? ` and ${filters.join(' and ')}` : ''

  // Conversations holding at least one message the homeserver does not have.
  // Ordered oldest-first so an interrupted run makes monotonic progress rather
  // than revisiting the same recent rows.
  const conversations = await connection.execute<PendingConversation[]>(
    `select c.id as conversation_id, c.tenant_id, c.organization_id, c.kind, c.title,
            count(m.id)::text as pending
       from chat_conversations c
       join chat_messages m on m.conversation_id = c.id
       left join chat_matrix_events e on e.message_id = m.id
      where c.deleted_at is null
        and m.kind = 'user'
        and m.deleted_at is null
        and e.id is null
        ${scoped}
      group by c.id, c.tenant_id, c.organization_id, c.kind, c.title
      order by min(m.created_at) asc
      limit ?`,
    params,
  )

  for (const conversation of conversations) {
    const scope = {
      tenantId: conversation.tenant_id,
      organizationId: conversation.organization_id,
    }
    const progress: BackfillProgress = {
      conversationId: conversation.conversation_id,
      roomsCreated: 0,
      messagesPublished: 0,
      messagesFailed: 0,
    }

    try {
      const members = await connection.execute<Array<{ user_id: string; role: string }>>(
        `select user_id, role from chat_participants where conversation_id = ?`,
        [conversation.conversation_id],
      )

      if (options.dryRun) {
        progress.messagesPublished = Number(conversation.pending)
        options.onProgress?.(progress)
        result.conversationsProcessed += 1
        result.messagesPublished += progress.messagesPublished
        continue
      }

      const roomDeps: RoomDeps = deps
      const hadRoom = await deps.em.getConnection().execute<Array<{ exists: boolean }>>(
        `select exists (select 1 from chat_matrix_rooms where conversation_id = ?) as exists`,
        [conversation.conversation_id],
      )
      const roomId = await ensureRoom(roomDeps, scope, {
        conversationId: conversation.conversation_id,
        kind: conversation.kind,
        title: conversation.title,
        memberUserIds: members.map((member) => member.user_id),
        ownerUserIds: members.filter((m) => m.role === 'owner').map((m) => m.user_id),
      })
      if (!hadRoom[0]?.exists) {
        progress.roomsCreated = 1
        result.roomsCreated += 1
      }

      const messages = await connection.execute<PendingMessage[]>(
        `select m.id, m.sender_user_id, m.body, m.created_at, m.reply_to_message_id
           from chat_messages m
           left join chat_matrix_events e on e.message_id = m.id
          where m.conversation_id = ?
            and m.kind = 'user'
            and m.deleted_at is null
            and e.id is null
          order by m.created_at asc, m.id asc`,
        [conversation.conversation_id],
      )

      for (const message of messages) {
        try {
          await publishOne(deps, scope, conversation, roomId, message)
          progress.messagesPublished += 1
          result.messagesPublished += 1
        } catch (error) {
          // One message that will not go must not abandon the rest of the
          // conversation. It stays in the work queue for the next run.
          progress.messagesFailed += 1
          result.messagesFailed += 1
          logger.warn('backfill could not publish a message', {
            conversationId: conversation.conversation_id,
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      progress.messagesFailed += Number(conversation.pending)
      result.messagesFailed += Number(conversation.pending)
      logger.warn('backfill could not provision a conversation', {
        conversationId: conversation.conversation_id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    options.onProgress?.(progress)
    result.conversationsProcessed += 1
  }

  return result
}

async function publishOne(
  deps: BackfillDeps,
  scope: { tenantId: string; organizationId: string },
  conversation: PendingConversation,
  roomId: string,
  message: PendingMessage,
): Promise<void> {
  const senderMxid = await ensureIdentity(deps, scope.tenantId, message.sender_user_id)

  const content: Record<string, unknown> = { msgtype: 'm.text', body: message.body }

  if (message.reply_to_message_id) {
    const parent = await deps.em.findOne(ChatMatrixEvent, {
      messageId: message.reply_to_message_id,
      tenantId: scope.tenantId,
    })
    // Ordering is oldest-first, so a parent inside this run is already mapped.
    // A parent that is still missing was itself unpublishable; the reply goes
    // out unthreaded rather than being held back behind it.
    if (parent) {
      content['m.relates_to'] = { 'm.in_reply_to': { event_id: parent.eventId } }
    }
  }

  // Through the shared helper, because a room provisioned from the CURRENT
  // participants does not contain the people who wrote its history and have
  // since left. Their messages are still in the transcript.
  const sent = await sendAsRoomMember(deps, scope.tenantId, {
    roomId,
    eventType: 'm.room.message',
    transactionId: deriveTransactionId(message.id),
    content,
    userId: message.sender_user_id,
    asUser: senderMxid,
  })

  const now = new Date()
  deps.em.persist(
    deps.em.create(ChatMatrixEvent, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      messageId: message.id,
      conversationId: conversation.conversation_id,
      roomId,
      eventId: sent.event_id,
      eventType: 'm.room.message',
      // The original send time, not now. This column exists so a later
      // reconciliation can line rows up against the homeserver's own timeline,
      // and stamping it with the backfill's clock would make every historical
      // message look like it arrived today.
      originServerTs: message.created_at,
      projectedAt: now,
      createdAt: now,
    }),
  )
  await deps.em.flush()
}
