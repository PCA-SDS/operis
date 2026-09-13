import { Migration } from '@mikro-orm/migrations'

/**
 * The link index behind the Shared panel's Links tab.
 *
 * Written when a message is sent, in the same transaction, exactly as mentions
 * are. Finding links by scanning message bodies instead would mean reading a
 * whole workspace's history to fill one screen.
 *
 * The composite foreign key on `(message_id, conversation_id)` is the same
 * construction mentions and reactions use: a link row cannot reference a
 * message in another conversation — or another organization — even if every
 * application-level check were removed.
 */
export class Migration20260910130000_chat_message_links extends Migration {
  override up(): void {
    this.addSql(`create table "chat_message_links" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "message_id" uuid not null,
      "conversation_id" uuid not null,
      "url" text not null,
      "host" text not null,
      "created_at" timestamptz not null,
      constraint "chat_message_links_pkey" primary key ("id")
    );`)

    // Saying the same link twice in one message is one thing shared.
    this.addSql(`alter table "chat_message_links" add constraint "chat_message_links_uq" unique ("message_id", "url");`)

    // The panel's own query: this conversation's links, newest first.
    this.addSql(`create index "chat_message_links_conversation_idx" on "chat_message_links" ("conversation_id", "created_at");`)

    this.addSql(`alter table "chat_message_links"
      add constraint "chat_message_links_message_fk"
      foreign key ("message_id", "conversation_id")
      references "chat_messages" ("id", "conversation_id")
      on update cascade on delete cascade;`)
  }

  override down(): void {
    this.addSql(`drop table if exists "chat_message_links" cascade;`)
  }
}

export default Migration20260910130000_chat_message_links
