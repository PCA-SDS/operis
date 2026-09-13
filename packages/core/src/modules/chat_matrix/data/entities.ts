import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'

/**
 * The mapping layer between Operis chat and a Matrix homeserver.
 *
 * Four tables, and deliberately nothing else. No `chat_*` table is altered and
 * no chat column is added, so "nothing else breaks" is a structural property
 * rather than a promise: every CHECK constraint, composite foreign key and GIN
 * index the chat module relies on is untouched, and rolling this back is
 * dropping four tables nothing else reads.
 *
 * Matrix owns the message stream. These tables record only which Matrix object
 * corresponds to which Operis row, so the projection can be idempotent and a
 * drifted room can be reconciled rather than guessed at.
 */

/** How far a room has got towards being usable. */
export type ChatMatrixRoomState = 'pending' | 'ready' | 'failed'

@Entity({ tableName: 'chat_matrix_identities' })
@Unique({ name: 'chat_matrix_identities_user_uq', properties: ['tenantId', 'userId'] })
@Unique({ name: 'chat_matrix_identities_mxid_uq', properties: ['mxid'] })
export class ChatMatrixIdentity {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  /**
   * `@om_u_<uuid without dashes>:<server name>`.
   *
   * Derived rather than allocated, so the mapping can be recomputed instead of
   * only looked up — which is what makes reconciling a drifted room possible.
   * Stored anyway because the derivation depends on `server_name`, and a row
   * minted under an old one must remain resolvable.
   */
  @Property({ name: 'mxid', type: 'text' })
  mxid!: string

  /**
   * When the homeserver acknowledged the account.
   *
   * Appservice users are not created implicitly — the first call as an
   * unregistered id fails — so this is the record that registration already
   * happened and need not be retried on every send.
   */
  @Property({ name: 'registered_at', type: Date, onCreate: () => new Date() })
  registeredAt: Date = new Date()

  /**
   * The display name last pushed to the homeserver, so a rename can be detected
   * without reading the profile back on every message.
   */
  @Property({ name: 'display_name', type: 'text', nullable: true })
  displayName?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null
}

/**
 * One conversation, one room.
 *
 * Both unique constraints carry a guarantee the application cannot make alone:
 * a conversation must never fan out into two rooms (its history would split),
 * and a room must never project into two conversations (one message would
 * appear twice, in two authorization scopes).
 */
@Entity({ tableName: 'chat_matrix_rooms' })
@Unique({ name: 'chat_matrix_rooms_conversation_uq', properties: ['conversationId'] })
@Unique({ name: 'chat_matrix_rooms_room_uq', properties: ['roomId'] })
@Index({ name: 'chat_matrix_rooms_scope_idx', properties: ['tenantId', 'organizationId'] })
export class ChatMatrixRoom {
  [OptionalProps]?: 'state' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** `chat_conversations.id`. A plain id — modules do not share ORM relations. */
  @Property({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string

  /** `!localpart:server_name`. */
  @Property({ name: 'room_id', type: 'text' })
  roomId!: string

  /**
   * `pending` until the homeserver has the room, its power levels and its
   * membership. A send against a `pending` room would land somewhere half-built,
   * so the transport waits rather than racing room creation.
   */
  @Property({ name: 'state', type: 'text', default: 'pending' })
  state: ChatMatrixRoomState = 'pending'

  /** Why provisioning failed, for the operator. Cleared on recovery. */
  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null
}

/**
 * Which Matrix event produced which Operis row.
 *
 * `event_id` unique is the idempotency key for the entire projection: the send
 * path writes a row inline, and the sync loop later sees the same event, finds
 * the row and skips it. Without that constraint a redelivered transaction
 * duplicates every message in it.
 *
 * `message_id` is nullable because not every projected event is a message — a
 * reaction, a redaction and a membership change all get rows so the loop can
 * tell "already handled" from "not seen yet".
 */
@Entity({ tableName: 'chat_matrix_events' })
@Unique({ name: 'chat_matrix_events_event_uq', properties: ['eventId'] })
@Index({
  name: 'chat_matrix_events_message_uq',
  expression:
    'create unique index "chat_matrix_events_message_uq" on "chat_matrix_events" ("message_id") where "message_id" is not null',
})
@Index({
  name: 'chat_matrix_events_subject_uq',
  expression:
    'create unique index "chat_matrix_events_subject_uq" on "chat_matrix_events" ("subject_key") where "subject_key" is not null',
})
@Index({ name: 'chat_matrix_events_room_idx', properties: ['roomId', 'originServerTs'] })
@Index({
  name: 'chat_matrix_events_unprojected_idx',
  expression:
    'create index "chat_matrix_events_unprojected_idx" on "chat_matrix_events" ("created_at") where "projected_at" is null',
})
export class ChatMatrixEvent {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** `chat_messages.id`, or null for an event that is not itself a message. */
  @Property({ name: 'message_id', type: 'uuid', nullable: true })
  messageId?: string | null

  /**
   * What this event represents, when it is not a message.
   *
   * A reaction has no Operis row that outlives it — the `chat_message_reactions`
   * row is deleted on un-react — so the mapping cannot be keyed on a row id.
   * It is keyed instead on the tuple that is unique by construction:
   * `reaction:<messageId>:<userId>:<emoji>`. That is what makes it possible to
   * find the event again in order to redact it.
   */
  @Property({ name: 'subject_key', type: 'text', nullable: true })
  subjectKey?: string | null

  @Property({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string

  @Property({ name: 'room_id', type: 'text' })
  roomId!: string

  /** `$base64` — the homeserver's own identifier for the event. */
  @Property({ name: 'event_id', type: 'text' })
  eventId!: string

  /** `m.room.message`, `m.reaction`, `m.room.redaction`, `m.room.member`. */
  @Property({ name: 'event_type', type: 'text' })
  eventType!: string

  /**
   * The homeserver's timestamp, kept alongside the Operis one.
   *
   * Operis timestamps come from the database clock (`chat/lib/clock.ts`) and the
   * transcript cursor is keyed on them, so this is recorded for reconciliation
   * rather than used for ordering — two clocks deciding one sort order is how a
   * message goes missing from a keyset page.
   */
  @Property({ name: 'origin_server_ts', type: Date })
  originServerTs!: Date

  /** Null means seen but not yet turned into Operis rows. */
  @Property({ name: 'projected_at', type: Date, nullable: true })
  projectedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * Appservice transactions already accepted, so a redelivery is a no-op.
 *
 * Unused while the appservice is pull-only (`url: null` in the registration).
 * It exists now because push mode's endpoint must be idempotent from its very
 * first request: Synapse retries a transaction until it is acknowledged, and
 * delivers them in order, so one double-applied batch is not a transient
 * annoyance but permanently duplicated history.
 *
 * Deliberately not tenant-scoped: a transaction is a homeserver-level unit that
 * may carry events for several tenants, and keying it by tenant would make the
 * deduplication miss.
 */
@Entity({ tableName: 'chat_matrix_txns' })
@Unique({ name: 'chat_matrix_txns_txn_uq', properties: ['txnId'] })
@Index({ name: 'chat_matrix_txns_received_idx', properties: ['receivedAt'] })
export class ChatMatrixTransaction {
  [OptionalProps]?: 'receivedAt'

  /**
   * A surrogate uuid, even though `txn_id` is the natural key.
   *
   * Not a stylistic choice: the query indexer aliases every table as `b` and
   * selects `b.id`, so an entity without an `id` column fails `yarn initialize`
   * for the whole application — not just for this module. The natural key keeps
   * its uniqueness constraint, which is what the deduplication actually needs.
   */
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** The homeserver's transaction id — the deduplication key. */
  @Property({ name: 'txn_id', type: 'text' })
  txnId!: string

  @Property({ name: 'received_at', type: Date, onCreate: () => new Date() })
  receivedAt: Date = new Date()

  /** Events in the batch as delivered, before parsing, so drops are visible. */
  @Property({ name: 'event_count', type: 'integer' })
  eventCount!: number

  /** Null between acknowledging the transaction and finishing its work. */
  @Property({ name: 'processed_at', type: Date, nullable: true })
  processedAt?: Date | null
}

/**
 * Where the sync loop has read up to.
 *
 * Deliberately **not** tenant-scoped. There is one appservice per deployment and
 * therefore one `/sync` stream, carrying events for every tenant at once; a
 * per-tenant cursor would have to re-read the same stream once per tenant and
 * would advance past another tenant's events while doing it.
 *
 * One row per named stream, so a future second reader (a bridge-only loop, say)
 * gets its own cursor without colliding with this one.
 */
@Entity({ tableName: 'chat_matrix_sync_state' })
@Unique({ name: 'chat_matrix_sync_state_stream_uq', properties: ['stream'] })
export class ChatMatrixSyncState {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  /**
   * A surrogate uuid, even though the stream name is the identity.
   *
   * The query indexer aliases every table as `b` and selects `b.id`; an entity
   * without an `id` column fails `yarn initialize` for the whole application.
   * The uniqueness that actually matters — one cursor per stream — is the
   * constraint above, not the primary key.
   */
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** The stream's name. `default` is the appservice's own /sync loop. */
  @Property({ name: 'stream', type: 'text' })
  stream!: string

  /** The homeserver's opaque `next_batch`. Null before the first successful read. */
  @Property({ name: 'sync_token', type: 'text', nullable: true })
  syncToken?: string | null

  /** When the loop last completed a pass, for staleness alerting. */
  @Property({ name: 'last_synced_at', type: Date, nullable: true })
  lastSyncedAt?: Date | null

  /** Why the last pass failed, cleared on the next success. */
  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null
}
