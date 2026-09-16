import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, Index, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'

/**
 * The join between a chat conversation and a task, owned by neither.
 *
 * Two tables, and no change to any `chat_*` or `tasks_*` table. That is what
 * makes "removing the integration cannot block anything" a structural fact
 * rather than a promise: dropping these two drops every trace of it, and no
 * foreign key from here can ever refuse a chat-side or task-side delete.
 *
 * Every reference across a module boundary is a plain `uuid` column for exactly
 * that reason — the same rule `chat_matrix` follows for rooms, and the same rule
 * the tasks module follows for user ids.
 */

/**
 * How far a create request got, so a retry knows what to do instead of guessing.
 *
 * A frozen wire vocabulary written into rows, so it carries a CHECK constraint the
 * same way the tasks module's statuses do: a value outside this set is a bug that
 * should fail at the database rather than sit in a column nothing knows how to read.
 */
export const CHAT_TASK_REQUEST_STATUSES = ['pending', 'completed', 'failed'] as const
export type ChatTaskRequestStatus = (typeof CHAT_TASK_REQUEST_STATUSES)[number]

/**
 * One conversation, one task, one link.
 *
 * `chat_task_links_scope_uq` is what makes "link this task here" idempotent: a
 * second attempt raises 23505 and converges on the row that won, rather than
 * stacking two cards for the same task in the same conversation. Partial on
 * `deleted_at is null`, so unlinking and linking again is allowed — the
 * constraint prevents duplicates, not history.
 */
@Entity({ tableName: 'chat_task_links' })
@Index({ name: 'chat_task_links_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'chat_task_links_conversation_idx',
  expression:
    `create index "chat_task_links_conversation_idx" on "chat_task_links" ("tenant_id", "organization_id", "conversation_id", "created_at") where "deleted_at" is null`,
})
@Index({
  name: 'chat_task_links_task_idx',
  expression:
    `create index "chat_task_links_task_idx" on "chat_task_links" ("tenant_id", "organization_id", "task_id") where "deleted_at" is null`,
})
@Index({
  name: 'chat_task_links_card_uq',
  expression:
    `create unique index "chat_task_links_card_uq" on "chat_task_links" ("card_message_id") where "card_message_id" is not null`,
})
@Unique({
  name: 'chat_task_links_scope_uq',
  expression:
    `create unique index "chat_task_links_scope_uq" on "chat_task_links" ("tenant_id", "organization_id", "conversation_id", "task_id") where "deleted_at" is null`,
})
export class ChatTaskLink {
  [OptionalProps]?:
    | 'sourceMessageId'
    | 'cardMessageId'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** A `chat_conversations.id`. No foreign key — see the note above. */
  @Property({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string

  /** A `tasks_tasks.id`. No foreign key, for the same reason. */
  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  /**
   * The message the task was raised from, when it was raised from one.
   *
   * This is the private half of the link and never leaves the module's own
   * authorized reads: revealing it requires proving the reader is in the
   * conversation *now*, which the task module cannot do and must never be asked
   * to. Null for a task created from the composer rather than from a message.
   */
  @Property({ name: 'source_message_id', type: 'uuid', nullable: true })
  sourceMessageId?: string | null

  /**
   * The card row in the transcript, once it has been published.
   *
   * Null is a real and expected state: the task exists and the card does not,
   * either because publication failed or because the caller asked for a link
   * without one. It is what the retry endpoint acts on, and it is why creating a
   * task and publishing its card are two recorded steps rather than one
   * all-or-nothing write the user cannot recover from.
   */
  @Property({ name: 'card_message_id', type: 'uuid', nullable: true })
  cardMessageId?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  /**
   * Present because this row is user-editable through the module's own
   * endpoints, and an editable entity without `updated_at` makes optimistic
   * locking a silent no-op.
   */
  @Property({
    name: 'updated_at',
    type: Date,
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
    nullable: true,
  })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * The idempotency ledger for "create a task from this conversation".
 *
 * The unique index is the whole mechanism. Creating a task, linking it and
 * publishing its card are three writes that cannot share one transaction — the
 * task command holds its own project-number lock and emits its own assignment
 * notification, and wrapping it would mean announcing an assignment inside a
 * transaction that may still roll back. So the sequence is made safe to repeat
 * instead of made atomic: the key is claimed first, and a retry reads what the
 * first attempt recorded rather than starting again.
 *
 * `request_hash` is what stops a key being reused for a different task. Without
 * it a client that reused a key by accident would be handed a task it never
 * asked for and told it had succeeded.
 */
@Entity({ tableName: 'chat_task_requests' })
@Index({ name: 'chat_task_requests_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({
  name: 'chat_task_requests_key_uq',
  properties: ['tenantId', 'organizationId', 'actorUserId', 'idempotencyKey'],
})
export class ChatTaskRequest {
  [OptionalProps]?: 'taskId' | 'linkId' | 'failureReason' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /**
   * Whose request this was, from the session.
   *
   * In the key, so one person's key can never replay another person's result —
   * which would hand a task's id to someone who may not read it.
   */
  @Property({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  /** SHA-256 of the canonicalized request, so a reused key with new input is refused. */
  @Property({ name: 'request_hash', type: 'text' })
  requestHash!: string

  @Property({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string | null

  @Enum({ items: () => [...CHAT_TASK_REQUEST_STATUSES], type: 'text', name: 'status' })
  status: ChatTaskRequestStatus = 'pending'

  @Property({ name: 'task_id', type: 'uuid', nullable: true })
  taskId?: string | null

  @Property({ name: 'link_id', type: 'uuid', nullable: true })
  linkId?: string | null

  /** Diagnostics only; never rendered to a user. */
  @Property({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({
    name: 'updated_at',
    type: Date,
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
    nullable: true,
  })
  updatedAt?: Date | null
}
