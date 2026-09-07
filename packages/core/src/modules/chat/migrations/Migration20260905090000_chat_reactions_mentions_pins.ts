import { Migration } from '@mikro-orm/migrations';

/**
 * Chat phase 3 — reactions, structural mentions, `@everyone`, and pinned messages.
 *
 * Additive only: three new tables and one defaulted column. Nothing existing
 * changes type or nullability, so the conversations, messages and read cursors
 * written by phases 1 and 2 keep working untouched.
 *
 * Every one of the three tables carries `conversation_id` alongside `message_id`
 * so it can take a COMPOSITE foreign key against
 * `chat_messages (id, conversation_id)` — the same construction phase 2 used for
 * replies. A single-column key would only prove the message exists somewhere; the
 * pair proves it exists in the conversation the row claims to belong to, so a
 * forged id from another space or another organization is unstorable even if
 * every application check above it were removed.
 *
 * The unique indexes are the other half. Reacting, mentioning and pinning are all
 * operations a user can trigger twice — by double-clicking, by two tabs, by two
 * people at once — and each one is idempotent because the database says so rather
 * than because the application remembered to check.
 */
export class Migration20260905090000_chat_reactions_mentions_pins extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "chat_messages" add column "mentions_everyone" boolean not null default false;`);

    this.addSql(`create table "chat_message_reactions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "message_id" uuid not null, "conversation_id" uuid not null, "user_id" uuid not null, "emoji" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "chat_message_reactions_message_idx" on "chat_message_reactions" ("message_id");`);
    this.addSql(`alter table "chat_message_reactions" add constraint "chat_message_reactions_uq" unique ("message_id", "user_id", "emoji");`);
    this.addSql(`alter table "chat_message_reactions" add constraint "chat_message_reactions_message_fk" foreign key ("message_id", "conversation_id") references "chat_messages" ("id", "conversation_id") on update no action on delete cascade;`);

    this.addSql(`create table "chat_message_mentions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "message_id" uuid not null, "conversation_id" uuid not null, "mentioned_user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "chat_message_mentions_user_idx" on "chat_message_mentions" ("mentioned_user_id", "conversation_id");`);
    this.addSql(`alter table "chat_message_mentions" add constraint "chat_message_mentions_uq" unique ("message_id", "mentioned_user_id");`);
    this.addSql(`alter table "chat_message_mentions" add constraint "chat_message_mentions_message_fk" foreign key ("message_id", "conversation_id") references "chat_messages" ("id", "conversation_id") on update no action on delete cascade;`);

    this.addSql(`create table "chat_pinned_messages" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "conversation_id" uuid not null, "message_id" uuid not null, "pinned_by_user_id" uuid not null, "pinned_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "chat_pinned_messages_recent_idx" on "chat_pinned_messages" ("conversation_id", "pinned_at");`);
    this.addSql(`alter table "chat_pinned_messages" add constraint "chat_pinned_messages_uq" unique ("conversation_id", "message_id");`);
    // `on delete cascade`: a pin pointing at a message that no longer exists is a
    // broken entry in the panel, so the pin goes with the message rather than
    // being left for application code to remember to clean up.
    this.addSql(`alter table "chat_pinned_messages" add constraint "chat_pinned_messages_message_fk" foreign key ("message_id", "conversation_id") references "chat_messages" ("id", "conversation_id") on update no action on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "chat_pinned_messages" cascade;`);
    this.addSql(`drop table if exists "chat_message_mentions" cascade;`);
    this.addSql(`drop table if exists "chat_message_reactions" cascade;`);
    this.addSql(`alter table "chat_messages" drop column if exists "mentions_everyone";`);
  }

}
