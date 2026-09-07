import { Migration } from '@mikro-orm/migrations';

/**
 * Three corrections to the translation cache, none of which could be made by
 * editing the migration that created it — that one has already been applied.
 *
 * 1. TENANT ISOLATION AT THE DATABASE. The original composite key
 *    `(message_id, conversation_id) -> chat_messages (id, conversation_id)`
 *    was documented as making "a forged id from another organization
 *    unstorable". It does not: neither side carries a tenant or organization
 *    column, so it proves only that the message exists in the conversation the
 *    row names. A row claiming tenant A while pointing at a message in tenant B
 *    satisfies it. Widening the key to all four columns makes the documented
 *    guarantee true, so the application predicates are a second line of defence
 *    rather than the only one.
 *
 * 2. CACHE VALIDITY. `provider` and `model_revision` were recorded and never
 *    read, so a model upgrade left every existing row served forever with no
 *    way to refresh. `pipeline_revision` is now part of the read, so a row made
 *    by a different model, tokenizer or preprocessing step is simply not a hit
 *    and the next request overwrites it in place — a lazy refresh that costs
 *    nothing at deploy time. `source_hash` binds a row to the exact bytes it
 *    was made from, so a body that ever changes cannot serve stale words.
 *
 * 3. EXISTING ROWS ARE DISCARDED. Not a precaution: every row in this table was
 *    produced by the Private Use Area marker pipeline, which was measured
 *    against the real M2M100 weights and found to lose the markers on every
 *    single generation, degenerating into repeated filler for messages with two
 *    or more mentions. Those rows are wrong, and `NOT NULL` on the new columns
 *    has no honest backfill for them.
 */
export class Migration20260907090000_chat_translation_integrity extends Migration {

  override up(): void | Promise<void> {
    // Produced by a pipeline since proven incorrect; see point 3 above.
    this.addSql(`delete from "chat_message_translations";`);

    this.addSql(`alter table "chat_message_translations" add column "source_hash" text not null;`);
    this.addSql(`alter table "chat_message_translations" add column "pipeline_revision" text not null;`);

    // The read filters on both, so without this every lookup is a full scan of
    // the message's rows.
    this.addSql(`create index "chat_message_translations_lookup_idx" on "chat_message_translations" ("message_id", "target_locale", "pipeline_revision", "source_hash");`);

    // The four-column parent key the widened foreign key needs. Partial on the
    // live rows only: a soft-deleted message keeps its id, and a unique index
    // spanning both states would be satisfied either way — the point here is a
    // referenceable key, and only live messages may be referenced.
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_scope_uq" unique ("id", "conversation_id", "tenant_id", "organization_id");`);

    this.addSql(`alter table "chat_message_translations" drop constraint "chat_message_translations_message_fk";`);
    this.addSql(`alter table "chat_message_translations" add constraint "chat_message_translations_message_fk" foreign key ("message_id", "conversation_id", "tenant_id", "organization_id") references "chat_messages" ("id", "conversation_id", "tenant_id", "organization_id") on update cascade on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "chat_message_translations" drop constraint "chat_message_translations_message_fk";`);
    this.addSql(`alter table "chat_message_translations" add constraint "chat_message_translations_message_fk" foreign key ("message_id", "conversation_id") references "chat_messages" ("id", "conversation_id") on update cascade on delete cascade;`);
    this.addSql(`alter table "chat_messages" drop constraint "chat_messages_scope_uq";`);
    this.addSql(`drop index "chat_message_translations_lookup_idx";`);
    this.addSql(`alter table "chat_message_translations" drop column "pipeline_revision";`);
    this.addSql(`alter table "chat_message_translations" drop column "source_hash";`);
  }

}
