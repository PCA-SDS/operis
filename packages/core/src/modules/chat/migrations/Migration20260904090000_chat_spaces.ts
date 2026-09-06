import { Migration } from '@mikro-orm/migrations';

/**
 * Chat phase 2 — named spaces with roles, and structural message replies.
 *
 * Additive only. Every new column is nullable or defaulted, no existing column
 * changes type, and no existing index or constraint is dropped — so the direct
 * conversations, messages and read cursors written by phase 1 keep working
 * untouched while this runs and afterwards.
 *
 * Three constraints carry guarantees the application cannot promise on its own:
 *
 * - `chat_conversations_kind_shape_chk` keeps the two conversation shapes
 *   mutually exclusive. A `direct` needs its pair key and no title; a `space`
 *   needs a title and no pair key. Without it a mis-set `kind` would produce a
 *   space nobody can name, or a direct that slips past the phase-1 pair-unique
 *   index because that index is scoped `where kind = 'direct'`.
 * - `chat_messages_reply_fk` is composite on `(id, conversation_id)`, so a reply
 *   must target a message in the SAME conversation. A single-column FK would
 *   prove only that the target exists somewhere — a forged id from another
 *   space, or another organization's conversation, would still be storable.
 * - `chat_participants_owner_idx` makes "does this space still have an owner?"
 *   an index lookup, which the leave/remove paths ask on every call.
 *
 * The backfill sets `role = 'member'` and `kind = 'user'` explicitly rather than
 * relying on the column default, so the statement is correct whether or not the
 * default was applied to pre-existing rows by this same migration.
 */
export class Migration20260904090000_chat_spaces extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "chat_conversations" add column "title" text null;`);
    this.addSql(`alter table "chat_conversations" add column "created_by_user_id" uuid null;`);
    this.addSql(`alter table "chat_conversations" add constraint "chat_conversations_kind_shape_chk" check (("kind" = 'direct' and "direct_key" is not null and "title" is null) or ("kind" = 'space' and "title" is not null and "direct_key" is null));`);

    this.addSql(`alter table "chat_participants" add column "role" text not null default 'member';`);
    this.addSql(`create index "chat_participants_owner_idx" on "chat_participants" ("conversation_id") where "role" = 'owner';`);

    this.addSql(`alter table "chat_messages" add column "kind" text not null default 'user';`);
    this.addSql(`alter table "chat_messages" add column "system_event" text null;`);
    this.addSql(`alter table "chat_messages" add column "system_target_user_id" uuid null;`);
    this.addSql(`alter table "chat_messages" add column "reply_to_message_id" uuid null;`);
    // The unique key the composite foreign key below needs as its target. `id`
    // is already the primary key, so this adds no new uniqueness — it only makes
    // the pair addressable by a foreign key.
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_id_conversation_uq" unique ("id", "conversation_id");`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_reply_fk" foreign key ("reply_to_message_id", "conversation_id") references "chat_messages" ("id", "conversation_id") on update no action on delete no action;`);
    this.addSql(`create index "chat_messages_reply_idx" on "chat_messages" ("reply_to_message_id") where "reply_to_message_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "chat_messages_reply_idx";`);
    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_reply_fk";`);
    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_id_conversation_uq";`);
    this.addSql(`alter table "chat_messages" drop column if exists "reply_to_message_id";`);
    this.addSql(`alter table "chat_messages" drop column if exists "system_target_user_id";`);
    this.addSql(`alter table "chat_messages" drop column if exists "system_event";`);
    this.addSql(`alter table "chat_messages" drop column if exists "kind";`);

    this.addSql(`drop index if exists "chat_participants_owner_idx";`);
    this.addSql(`alter table "chat_participants" drop column if exists "role";`);

    this.addSql(`alter table "chat_conversations" drop constraint if exists "chat_conversations_kind_shape_chk";`);
    this.addSql(`alter table "chat_conversations" drop column if exists "created_by_user_id";`);
    this.addSql(`alter table "chat_conversations" drop column if exists "title";`);
  }

}
