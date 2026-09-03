import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'

/**
 * Kinds a conversation can take. Only `direct` is written in Phase 1; the column
 * exists so a later group/space row can join the same tables without a rename.
 */
export type ChatConversationKind = 'direct'

/**
 * A conversation between a fixed set of people inside one organization.
 *
 * `directKey` is the canonical identity of a 1:1 pair — the two user ids sorted
 * and joined — and the unique index over it is what makes "Alice starts a chat
 * with Bob" and "Bob starts a chat with Alice" converge on one row even when
 * both requests land at the same instant. Application-level "find or create"
 * cannot promise that; a unique constraint can.
 *
 * The last-message columns are denormalized on purpose: the conversation list is
 * read far more often than it is written, and without them every row would need
 * its own "newest message" query.
 */
@Entity({ tableName: 'chat_conversations' })
@Index({ name: 'chat_conversations_scope_recent_idx', properties: ['tenantId', 'organizationId', 'lastMessageAt', 'id'] })
@Index({
  name: 'chat_conversations_direct_uq',
  expression:
    `create unique index "chat_conversations_direct_uq" on "chat_conversations" ("tenant_id", "organization_id", "direct_key") where "kind" = 'direct' and "direct_key" is not null and "deleted_at" is null`,
})
export class ChatConversation {
  [OptionalProps]?:
    | 'kind'
    | 'directKey'
    | 'lastMessageAt'
    | 'lastMessagePreview'
    | 'lastMessageSenderUserId'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text', default: 'direct' })
  kind: ChatConversationKind = 'direct'

  @Property({ name: 'direct_key', type: 'text', nullable: true })
  directKey?: string | null

  /**
   * Sort key for the conversation list. Seeded with the creation time rather
   * than left null, so a brand-new conversation sorts with the newest and the
   * keyset cursor compares one indexed column instead of a COALESCE.
   */
  @Property({ name: 'last_message_at', type: Date, onCreate: () => new Date() })
  lastMessageAt: Date = new Date()

  @Property({ name: 'last_message_preview', type: 'text', nullable: true })
  lastMessagePreview?: string | null

  @Property({ name: 'last_message_sender_user_id', type: 'uuid', nullable: true })
  lastMessageSenderUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Membership of one person in one conversation, and their read cursor.
 *
 * `lastReadAt` is the whole unread model: everything newer than it, from someone
 * else, is unread. That keeps unread state to one row per person per
 * conversation instead of one row per message per person, and it stays correct
 * across refreshes, tabs and devices because it lives on the server.
 */
@Entity({ tableName: 'chat_participants' })
@Unique({ name: 'chat_participants_conversation_user_uq', properties: ['conversationId', 'userId'] })
@Index({ name: 'chat_participants_scope_user_idx', properties: ['tenantId', 'organizationId', 'userId'] })
@Index({ name: 'chat_participants_conversation_idx', properties: ['conversationId'] })
export class ChatParticipant {
  [OptionalProps]?: 'lastReadAt' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'last_read_at', type: Date, nullable: true })
  lastReadAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null
}

/**
 * One turn in a conversation. Append-only: Phase 1 has no edit and no delete, so
 * the row is written once and read many times.
 *
 * `clientMessageId` is the idempotency key. A composer that retries after a
 * timeout sends the same id, and the partial unique index turns the second write
 * into a conflict the send command resolves by returning the message already
 * stored — so a flaky network cannot double-post.
 *
 * `body` is plain text and is rendered as a text node. Nothing in this module
 * parses it as HTML or markdown.
 */
@Entity({ tableName: 'chat_messages' })
@Index({ name: 'chat_messages_conversation_created_idx', properties: ['conversationId', 'createdAt'] })
@Index({ name: 'chat_messages_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'chat_messages_client_id_uq',
  expression:
    `create unique index "chat_messages_client_id_uq" on "chat_messages" ("conversation_id", "client_message_id") where "client_message_id" is not null and "deleted_at" is null`,
})
export class ChatMessage {
  [OptionalProps]?: 'clientMessageId' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string

  @Property({ name: 'sender_user_id', type: 'uuid' })
  senderUserId!: string

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'client_message_id', type: 'text', nullable: true })
  clientMessageId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
