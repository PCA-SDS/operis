import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatConversation, ChatMessage, ChatParticipant } from '../data/entities'
import type {
  ChatConversationDto,
  ChatConversationListDto,
  ChatMessageDto,
  ChatMessagePageDto,
} from '../data/types'
import {
  DEFAULT_CONVERSATION_PAGE_SIZE,
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_CONVERSATION_PAGE_SIZE,
  MAX_MESSAGE_PAGE_SIZE,
} from '../data/validators'
import { decodeCursor, encodeCursor } from '../lib/cursor'
import { loadOrganizationMembers, type ChatScope } from '../lib/scope'
import { loadChatMessages } from '../lib/messages'

/**
 * The chat tables as Kysely sees them.
 *
 * Counting unread messages is an aggregate over a join, which the ORM cannot
 * express without loading rows — so it is written as SQL, and this type is what
 * keeps that SQL checked against the real column names instead of `any`.
 */
type ChatDatabase = {
  chat_conversations: {
    id: string
    tenant_id: string
    organization_id: string
    last_message_at: Date
    last_message_preview: string | null
    last_message_sender_user_id: string | null
    deleted_at: Date | null
  }
  chat_participants: {
    conversation_id: string
    user_id: string
    tenant_id: string
    organization_id: string
    last_read_at: Date | null
  }
  chat_messages: {
    conversation_id: string
    sender_user_id: string
    tenant_id: string
    organization_id: string
    created_at: Date
    deleted_at: Date | null
  }
}

/**
 * The conversation columns the list renders.
 *
 * Named separately because the list reads them through Kysely (snake_case) and
 * `getConversation` reads them through the ORM (camelCase) — both funnel into
 * the same decorator rather than duplicating it.
 */
type ChatConversationRow = {
  id: string
  last_message_at: Date | string
  last_message_preview: string | null
  last_message_sender_user_id: string | null
}

/** Postgres may hand a timestamp back as a Date or as a string, depending on the driver path. */
function toIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export type ChatReadContext = {
  em: EntityManager
  scope: ChatScope
  userId: string
}

function toMessageDto(message: ChatMessage): ChatMessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    clientMessageId: message.clientMessageId ?? null,
  }
}

/**
 * Chat's read model.
 *
 * Every method takes the caller's identity and scope and applies them itself.
 * There is no "load conversation" that skips the membership check and no way to
 * ask for someone else's view — an id that the caller is not a participant of is
 * indistinguishable from one that does not exist.
 */
export interface ChatService {
  /**
   * The caller's membership row for a conversation, or a 404.
   *
   * This is the authorization gate for every conversation-scoped operation. It
   * answers 404 rather than 403 for a conversation the caller is not in: a 403
   * would confirm the id exists, which is exactly what an id-guessing probe is
   * looking for.
   */
  requireParticipant(
    ctx: ChatReadContext,
    conversationId: string,
  ): Promise<{ participant: ChatParticipant; conversation: ChatConversation }>

  /**
   * The caller's conversations, most recently active first.
   *
   * Bounded top-N rather than cursor pagination — see the implementation for
   * why a keyset is the wrong tool for a list whose ordering key is mutable.
   */
  listConversations(
    ctx: ChatReadContext,
    options: { limit?: number },
  ): Promise<ChatConversationListDto>

  getConversation(ctx: ChatReadContext, conversationId: string): Promise<ChatConversationDto>

  listMessages(
    ctx: ChatReadContext,
    conversationId: string,
    options: { cursor?: string; limit?: number },
  ): Promise<ChatMessagePageDto>

  /** Unread messages across every conversation the caller is in. */
  countUnread(ctx: ChatReadContext): Promise<number>
}

export class DefaultChatService implements ChatService {
  async requireParticipant(
    ctx: ChatReadContext,
    conversationId: string,
  ): Promise<{ participant: ChatParticipant; conversation: ChatConversation }> {
    const messages = await loadChatMessages()
    const participant = await ctx.em.findOne(ChatParticipant, {
      conversationId,
      userId: ctx.userId,
      tenantId: ctx.scope.tenantId,
      organizationId: ctx.scope.organizationId,
    })
    if (!participant) throw notFound(messages.conversationNotFound)

    // Membership alone is not enough: a conversation soft-deleted, or one whose
    // scope no longer matches the caller's, must not be readable through a
    // participant row that outlived it.
    const conversation = await ctx.em.findOne(ChatConversation, {
      id: conversationId,
      tenantId: ctx.scope.tenantId,
      organizationId: ctx.scope.organizationId,
      deletedAt: null,
    })
    if (!conversation) throw notFound(messages.conversationNotFound)

    // Both rows are returned so callers do not re-query what this already
    // loaded — `getConversation` was issuing the identical `findOne` twice.
    return { participant, conversation }
  }

  async listConversations(
    ctx: ChatReadContext,
    options: { limit?: number },
  ): Promise<ChatConversationListDto> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE, 1),
      MAX_CONVERSATION_PAGE_SIZE,
    )

    // One query, and membership is an `EXISTS` rather than a pre-fetched id list.
    //
    // What this replaced was two queries: load every participant row for the
    // caller, then pass their conversation ids back as a literal `IN (...)`. That
    // first step was unbounded — at 500 conversations it sequentially scanned and
    // hydrated 500 entities, then sent a 22.5 KB SQL literal, on every request.
    //
    // Measured note, because the obvious assumption is wrong: the `IN` list did
    // NOT stop the planner using `chat_conversations_scope_recent_idx` for
    // ordering. Postgres used the same backward index scan either way. The win
    // here is the removed round trip and the removed unbounded fetch, not an
    // index-usage fix.
    const rows = await ctx.em
      .getKysely<ChatDatabase>()
      .selectFrom('chat_conversations as c')
      .where('c.tenant_id', '=', ctx.scope.tenantId)
      .where('c.organization_id', '=', ctx.scope.organizationId)
      .where('c.deleted_at', 'is', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('chat_participants as p')
            .select(sql`1`.as('one'))
            .whereRef('p.conversation_id', '=', 'c.id')
            .where('p.user_id', '=', ctx.userId)
            .where('p.tenant_id', '=', ctx.scope.tenantId)
            .where('p.organization_id', '=', ctx.scope.organizationId),
        ),
      )
      .orderBy('c.last_message_at', 'desc')
      .orderBy('c.id', 'desc')
      // One extra row is the `hasMore` probe.
      .limit(limit + 1)
      .select(['c.id', 'c.last_message_at', 'c.last_message_preview', 'c.last_message_sender_user_id'])
      .execute()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return { items: await this.decorateConversations(ctx, page), hasMore }
  }

  async getConversation(ctx: ChatReadContext, conversationId: string): Promise<ChatConversationDto> {
    const { conversation } = await this.requireParticipant(ctx, conversationId)
    const [dto] = await this.decorateConversations(ctx, [
      {
        id: conversation.id,
        last_message_at: conversation.lastMessageAt,
        last_message_preview: conversation.lastMessagePreview ?? null,
        last_message_sender_user_id: conversation.lastMessageSenderUserId ?? null,
      },
    ])
    if (!dto) throw notFound((await loadChatMessages()).conversationNotFound)
    return dto
  }

  async listMessages(
    ctx: ChatReadContext,
    conversationId: string,
    options: { cursor?: string; limit?: number },
  ): Promise<ChatMessagePageDto> {
    await this.requireParticipant(ctx, conversationId)

    const limit = Math.min(Math.max(options.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, 1), MAX_MESSAGE_PAGE_SIZE)
    const cursor = decodeCursor(options.cursor)

    // Read newest-first so "open the conversation" costs one page regardless of
    // how long the history is, then reverse for rendering.
    const where: Record<string, unknown> = {
      conversationId,
      tenantId: ctx.scope.tenantId,
      organizationId: ctx.scope.organizationId,
      deletedAt: null,
    }
    if (cursor) {
      where.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
      ]
    }

    const rows = await ctx.em.find(ChatMessage, where, {
      orderBy: { createdAt: 'desc', id: 'desc' },
      limit: limit + 1,
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const oldest = page[page.length - 1]

    return {
      items: page.slice().reverse().map(toMessageDto),
      nextCursor: hasMore && oldest ? encodeCursor({ createdAt: oldest.createdAt, id: oldest.id }) : null,
      hasMore,
    }
  }

  async countUnread(ctx: ChatReadContext): Promise<number> {
    const row = await this.unreadQuery(ctx)
      .select(sql<number>`count(*)`.as('count'))
      .executeTakeFirst()
    return Number((row as { count?: string | number } | undefined)?.count ?? 0)
  }

  /**
   * The unread predicate, as SQL.
   *
   * Unread is derived from each participant row's `last_read_at` cursor —
   * anything newer, from someone else. Deriving it rather than storing a counter
   * means it cannot drift when a write fails halfway, and joining the cursor in
   * SQL means the database evaluates it per row instead of the service building
   * one OR branch per conversation.
   */
  private unreadQuery(ctx: ChatReadContext) {
    return ctx.em
      .getKysely<ChatDatabase>()
      .selectFrom('chat_messages as m')
      .innerJoin('chat_participants as p', (join) =>
        join
          .onRef('p.conversation_id', '=', 'm.conversation_id')
          .on('p.user_id', '=', ctx.userId)
          .on('p.tenant_id', '=', ctx.scope.tenantId)
          .on('p.organization_id', '=', ctx.scope.organizationId),
      )
      .innerJoin('chat_conversations as c', (join) =>
        join.onRef('c.id', '=', 'm.conversation_id').on('c.deleted_at', 'is', null),
      )
      .where('m.tenant_id', '=', ctx.scope.tenantId)
      .where('m.organization_id', '=', ctx.scope.organizationId)
      .where('m.deleted_at', 'is', null)
      // Your own messages are never unread to you.
      .where('m.sender_user_id', '!=', ctx.userId)
      // `coalesce`, not `OR`. A disjunction cannot be pushed into the index
      // bound, so the planner would scan every message in every one of the
      // caller's conversations and filter afterwards. Collapsing the null case
      // into a single comparison keeps this an index condition on
      // `(conversation_id, created_at)`, so it reads only the unread tail — and
      // nothing at all for someone who is caught up.
      .where(
        sql<boolean>`m.created_at > coalesce(p.last_read_at, '-infinity'::timestamptz)`,
      )
  }

  /**
   * Unread counts for the conversations on one page of the list — a single
   * grouped aggregate, not a query per row and not a row per unread message.
   */
  private async countUnreadPerConversation(
    ctx: ChatReadContext,
    conversationIds: readonly string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    if (conversationIds.length === 0) return counts

    const rows = await this.unreadQuery(ctx)
      .where('m.conversation_id', 'in', [...conversationIds])
      .select((eb) => ['m.conversation_id as conversation_id', eb.fn.countAll().as('count')])
      .groupBy('m.conversation_id')
      .execute()

    for (const row of rows as Array<{ conversation_id: string; count: string | number }>) {
      counts.set(row.conversation_id, Number(row.count))
    }
    return counts
  }

  /**
   * Turn conversation rows into what the list renders: the other person, the
   * preview, and the unread count.
   *
   * Three queries, constant in the number of conversations the caller has and
   * bounded by the page size — the participant rows for this page (which supply
   * both the counterpart and the caller's own read cursor), one batched people
   * lookup, and one grouped unread aggregate.
   */
  private async decorateConversations(
    ctx: ChatReadContext,
    conversations: ChatConversationRow[],
  ): Promise<ChatConversationDto[]> {
    if (conversations.length === 0) return []

    const conversationIds = conversations.map((conversation) => conversation.id)
    const participants = await ctx.em.find(ChatParticipant, {
      conversationId: { $in: conversationIds },
      tenantId: ctx.scope.tenantId,
      organizationId: ctx.scope.organizationId,
    })

    const counterpartByConversation = new Map<string, string>()
    const membershipByConversation = new Map<string, ChatParticipant>()
    for (const participant of participants) {
      if (participant.userId === ctx.userId) membershipByConversation.set(participant.conversationId, participant)
      else counterpartByConversation.set(participant.conversationId, participant.userId)
    }

    const people = await loadOrganizationMembers(ctx.em, ctx.scope, [...counterpartByConversation.values()])
    const unreadCounts = await this.countUnreadPerConversation(ctx, conversationIds)

    return conversations.map((conversation) => {
      const counterpartId = counterpartByConversation.get(conversation.id) ?? null
      const person = counterpartId ? people.get(counterpartId) ?? null : null
      const membership = membershipByConversation.get(conversation.id) ?? null
      return {
        id: conversation.id,
        counterpart: person ? { id: person.id, name: person.name, email: person.email } : null,
        lastMessageAt: toIsoString(conversation.last_message_at),
        lastMessagePreview: conversation.last_message_preview ?? null,
        lastMessageSenderUserId: conversation.last_message_sender_user_id ?? null,
        unreadCount: unreadCounts.get(conversation.id) ?? 0,
        lastReadAt: membership?.lastReadAt?.toISOString() ?? null,
      }
    })
  }
}
