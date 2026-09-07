import { Migration } from '@mikro-orm/migrations';

/**
 * Chat module — direct conversations, membership with a read cursor, and an
 * append-only message log.
 *
 * Two partial unique indexes carry the module's correctness guarantees and are
 * the reason this is not three plain CREATE TABLEs:
 *
 * - `chat_conversations_direct_uq` makes one conversation per pair of people a
 *   database fact, so simultaneous "message them" from both sides converges
 *   instead of forking into two half-conversations.
 * - `chat_messages_client_id_uq` makes a retried send idempotent, so a request
 *   that timed out after committing does not post twice.
 *
 * Additive only: three new tables, no changes to existing ones, nothing dropped.
 */
export class Migration20260903090000_chat extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "chat_conversations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "kind" text not null default 'direct', "direct_key" text null, "last_message_at" timestamptz not null, "last_message_preview" text null, "last_message_sender_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "chat_conversations_scope_recent_idx" on "chat_conversations" ("tenant_id", "organization_id", "last_message_at", "id");`);
    this.addSql(`create unique index "chat_conversations_direct_uq" on "chat_conversations" ("tenant_id", "organization_id", "direct_key") where "kind" = 'direct' and "direct_key" is not null and "deleted_at" is null;`);

    this.addSql(`create table "chat_participants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "conversation_id" uuid not null, "user_id" uuid not null, "last_read_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "chat_participants_conversation_idx" on "chat_participants" ("conversation_id");`);
    this.addSql(`create index "chat_participants_scope_user_idx" on "chat_participants" ("tenant_id", "organization_id", "user_id");`);
    this.addSql(`alter table "chat_participants" add constraint "chat_participants_conversation_user_uq" unique ("conversation_id", "user_id");`);

    this.addSql(`create table "chat_messages" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "conversation_id" uuid not null, "sender_user_id" uuid not null, "body" text not null, "client_message_id" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "chat_messages_conversation_created_idx" on "chat_messages" ("conversation_id", "created_at");`);
    this.addSql(`create index "chat_messages_scope_idx" on "chat_messages" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "chat_messages_client_id_uq" on "chat_messages" ("conversation_id", "client_message_id") where "client_message_id" is not null and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "chat_messages" cascade;`);
    this.addSql(`drop table if exists "chat_participants" cascade;`);
    this.addSql(`drop table if exists "chat_conversations" cascade;`);
  }

}
