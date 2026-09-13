import { Migration } from '@mikro-orm/migrations'

/**
 * The mapping layer between chat conversations and Matrix rooms.
 *
 * Five new tables and **no change to any `chat_*` table**. Every CHECK
 * constraint, composite foreign key and GIN index the chat module depends on
 * stays exactly as it is, so switching the transport cannot break a guarantee
 * the schema already makes — and rolling it back is `down()`, which drops five
 * tables nothing else reads.
 *
 * Five constraints carry guarantees the application cannot promise alone:
 *
 * - **`chat_matrix_rooms_conversation_uq`** — one conversation can never fan out
 *   into two rooms. Without it a retried provisioning attempt splits history
 *   with no way to tell which room is real.
 * - **`chat_matrix_rooms_room_uq`** — one room can never project into two
 *   conversations. Without it a single message appears twice, under two
 *   different authorization scopes.
 * - **`chat_matrix_events_event_uq`** — the idempotency key for the projection.
 *   The send path writes a row inside the transaction that creates the message;
 *   the sync loop later finds it and skips. Without it a redelivered event
 *   duplicates history permanently.
 * - **`chat_matrix_events_subject_uq`** — one mirrored event per reaction. A
 *   `chat_message_reactions` row is DELETED on un-react, so the mapping cannot
 *   be keyed on a row id; it is keyed on `reaction:<message>:<user>:<emoji>`,
 *   which is what makes the annotation findable again in order to redact it.
 * - **`chat_matrix_sync_state_stream_uq`** — one cursor per stream. Two rows for
 *   `default` would be two readers each advancing past the other's unread events.
 *
 * **Every table takes a surrogate uuid primary key, including the two with a
 * perfectly good natural one** (`chat_matrix_txns.txn_id`,
 * `chat_matrix_sync_state.stream`). Not stylistic: the query indexer aliases
 * every table as `b` and selects `b.id`, so an entity without an `id` column
 * fails `yarn initialize` for the whole application — which is how this was
 * found. The natural keys keep their uniqueness constraints, which is what the
 * deduplication actually depends on.
 *
 * There are deliberately **no foreign keys to `chat_conversations` or
 * `chat_messages`**: modules do not form ORM relations across their boundary,
 * and a hard FK here would let these tables block a chat-side delete.
 */
export class Migration20260910024048_chat_matrix extends Migration {
  override up(): void {
    this.addSql(`create table "chat_matrix_identities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "user_id" uuid not null, "mxid" text not null, "registered_at" timestamptz not null, "display_name" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`)
    this.addSql(`alter table "chat_matrix_identities" add constraint "chat_matrix_identities_mxid_uq" unique ("mxid");`)
    this.addSql(`alter table "chat_matrix_identities" add constraint "chat_matrix_identities_user_uq" unique ("tenant_id", "user_id");`)

    this.addSql(`create table "chat_matrix_rooms" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "conversation_id" uuid not null, "room_id" text not null, "state" text not null default 'pending', "last_error" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`)
    this.addSql(`create index "chat_matrix_rooms_scope_idx" on "chat_matrix_rooms" ("tenant_id", "organization_id");`)
    this.addSql(`alter table "chat_matrix_rooms" add constraint "chat_matrix_rooms_room_uq" unique ("room_id");`)
    this.addSql(`alter table "chat_matrix_rooms" add constraint "chat_matrix_rooms_conversation_uq" unique ("conversation_id");`)

    this.addSql(`create table "chat_matrix_events" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "message_id" uuid null, "subject_key" text null, "conversation_id" uuid not null, "room_id" text not null, "event_id" text not null, "event_type" text not null, "origin_server_ts" timestamptz not null, "projected_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`)
    this.addSql(`create index "chat_matrix_events_unprojected_idx" on "chat_matrix_events" ("created_at") where "projected_at" is null;`)
    this.addSql(`create index "chat_matrix_events_room_idx" on "chat_matrix_events" ("room_id", "origin_server_ts");`)
    this.addSql(`create unique index "chat_matrix_events_subject_uq" on "chat_matrix_events" ("subject_key") where "subject_key" is not null;`)
    this.addSql(`create unique index "chat_matrix_events_message_uq" on "chat_matrix_events" ("message_id") where "message_id" is not null;`)
    this.addSql(`alter table "chat_matrix_events" add constraint "chat_matrix_events_event_uq" unique ("event_id");`)

    this.addSql(`create table "chat_matrix_sync_state" ("id" uuid not null default gen_random_uuid(), "stream" text not null, "sync_token" text null, "last_synced_at" timestamptz null, "last_error" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`)
    this.addSql(`alter table "chat_matrix_sync_state" add constraint "chat_matrix_sync_state_stream_uq" unique ("stream");`)

    this.addSql(`create table "chat_matrix_txns" ("id" uuid not null default gen_random_uuid(), "txn_id" text not null, "received_at" timestamptz not null, "event_count" int not null, "processed_at" timestamptz null, primary key ("id"));`)
    this.addSql(`create index "chat_matrix_txns_received_idx" on "chat_matrix_txns" ("received_at");`)
    this.addSql(`alter table "chat_matrix_txns" add constraint "chat_matrix_txns_txn_uq" unique ("txn_id");`)
  }

  override down(): void {
    this.addSql(`drop table if exists "chat_matrix_txns" cascade;`)
    this.addSql(`drop table if exists "chat_matrix_sync_state" cascade;`)
    this.addSql(`drop table if exists "chat_matrix_events" cascade;`)
    this.addSql(`drop table if exists "chat_matrix_rooms" cascade;`)
    this.addSql(`drop table if exists "chat_matrix_identities" cascade;`)
  }
}

export default Migration20260910024048_chat_matrix
