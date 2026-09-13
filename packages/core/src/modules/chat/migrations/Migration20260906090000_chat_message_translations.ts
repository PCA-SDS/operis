import { Migration } from '@mikro-orm/migrations';

/**
 * Chat translation — cached per-language renderings of a message, and the
 * reading language each person chose.
 *
 * Additive only: two new tables, nothing existing altered. Every conversation,
 * message, reaction, mention and pin written before this keeps working untouched.
 *
 * `chat_message_translations` carries `conversation_id` alongside `message_id` so
 * it can take a COMPOSITE foreign key against `chat_messages (id, conversation_id)`
 * — the construction replies, reactions, mentions and pins all use. A
 * single-column key would only prove the message exists somewhere; the pair proves
 * it exists in the conversation the row claims, so a forged id from another space
 * or another organization is unstorable even with every application check removed.
 *
 * The unique key is `(message_id, target_locale)` rather than anything per-viewer:
 * a translation belongs to the message and the language, not to the person who
 * asked. Two colleagues reading in French share one row, and it also makes the
 * write idempotent — two people pressing Translate at the same moment converge
 * instead of racing to insert twice.
 *
 * `chat_user_settings` is keyed `(user_id, organization_id)`, not by user alone:
 * the same person in two organizations may read in two languages.
 */
export class Migration20260906090000_chat_message_translations extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "chat_message_translations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "message_id" uuid not null, "conversation_id" uuid not null, "target_locale" text not null, "body" text not null, "source_locale" text null, "provider" text not null, "model_revision" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "chat_message_translations_message_idx" on "chat_message_translations" ("message_id");`);
    this.addSql(`alter table "chat_message_translations" add constraint "chat_message_translations_uq" unique ("message_id", "target_locale");`);
    this.addSql(`alter table "chat_message_translations" add constraint "chat_message_translations_message_fk" foreign key ("message_id", "conversation_id") references "chat_messages" ("id", "conversation_id") on update cascade on delete cascade;`);

    this.addSql(`create table "chat_user_settings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "translation_locale" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "chat_user_settings" add constraint "chat_user_settings_uq" unique ("user_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "chat_user_settings" cascade;`);
    this.addSql(`drop table if exists "chat_message_translations" cascade;`);
  }

}
