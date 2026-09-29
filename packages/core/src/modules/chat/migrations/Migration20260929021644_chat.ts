import { Migration } from '@mikro-orm/migrations';

/**
 * External participants: somebody who is not an Operis user can be in a chat
 * conversation. Spec: `.ai/specs/2026-09-29-chat-external-participants.md`.
 *
 * Additive. Every existing row names a colleague, so it already satisfies every
 * CHECK added here, and nothing is backfilled.
 *
 * Four foreign keys carry what the application cannot promise alone, and are
 * written here by hand because the snapshot cannot express composite keys:
 *
 * - `chat_participants_external_conversation_fk` — `(conversation_id,
 *   conversation_kind)` against `chat_conversations (id, kind)`. Only an
 *   outsider's row sets `conversation_kind`, and only to `'external'`, so an
 *   outsider in a direct or a space is a row Postgres refuses. A colleague's row
 *   leaves it NULL, and a key with a NULL in it is not checked.
 * - `chat_participants_external_contact_fk`, `chat_messages_sender_external_contact_fk`,
 *   `chat_message_reactions_external_contact_fk` — each against
 *   `chat_external_contacts (id, tenant_id, organization_id)`, so no row can name
 *   another organization's contact. `no action` on delete: a contact that is
 *   referenced cannot be removed; erasure will anonymise it instead.
 *
 * The down migration works only while no external conversation and no
 * outsider row exists — restoring `not null` and the two-kind CHECK fails
 * otherwise, which is the correct refusal.
 */
export class Migration20260929021644_chat extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "chat_external_contacts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "network" text not null, "display_name" text not null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "chat_external_contacts_scope_idx" on "chat_external_contacts" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "chat_external_contacts" add constraint "chat_external_contacts_scope_uq" unique ("id", "tenant_id", "organization_id");`);
    this.addSql(`alter table "chat_external_contacts" add constraint "chat_external_contacts_network_chk" check ("network" ~ '^[a-z][a-z0-9-]{0,31}\$');`);

    this.addSql(`alter table "chat_conversations" drop constraint if exists "chat_conversations_kind_shape_chk";`);
    this.addSql(`alter table "chat_conversations" add constraint "chat_conversations_id_kind_uq" unique ("id", "kind");`);
    this.addSql(`alter table "chat_conversations" add constraint "chat_conversations_kind_shape_chk" check (("kind" = 'direct' and "direct_key" is not null and "title" is null) or ("kind" = 'space' and "title" is not null and "direct_key" is null) or ("kind" = 'external' and "direct_key" is null));`);

    this.addSql(`alter table "chat_participants" add "external_contact_id" uuid null, add "conversation_kind" text null;`);
    this.addSql(`alter table "chat_participants" alter column "user_id" drop not null;`);
    this.addSql(`alter table "chat_participants" add constraint "chat_participants_conversation_contact_uq" unique ("conversation_id", "external_contact_id");`);
    this.addSql(`alter table "chat_participants" add constraint "chat_participants_identity_chk" check (num_nonnulls("user_id", "external_contact_id") = 1);`);
    this.addSql(`alter table "chat_participants" add constraint "chat_participants_external_shape_chk" check (("external_contact_id" is null) = ("conversation_kind" is null) and ("conversation_kind" is null or "conversation_kind" = 'external') and ("external_contact_id" is null or "role" = 'member'));`);
    this.addSql(`alter table "chat_participants" add constraint "chat_participants_external_contact_fk" foreign key ("external_contact_id", "tenant_id", "organization_id") references "chat_external_contacts" ("id", "tenant_id", "organization_id") on update no action on delete no action;`);
    this.addSql(`alter table "chat_participants" add constraint "chat_participants_external_conversation_fk" foreign key ("conversation_id", "conversation_kind") references "chat_conversations" ("id", "kind") on update no action on delete cascade;`);

    this.addSql(`alter table "chat_messages" add "sender_external_contact_id" uuid null;`);
    this.addSql(`alter table "chat_messages" alter column "sender_user_id" drop not null;`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_sender_chk" check (num_nonnulls("sender_user_id", "sender_external_contact_id") = 1 and ("sender_external_contact_id" is null or "kind" = 'user'));`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_sender_external_contact_fk" foreign key ("sender_external_contact_id", "tenant_id", "organization_id") references "chat_external_contacts" ("id", "tenant_id", "organization_id") on update no action on delete no action;`);

    this.addSql(`alter table "chat_message_reactions" add "external_contact_id" uuid null;`);
    this.addSql(`alter table "chat_message_reactions" alter column "user_id" drop not null;`);
    this.addSql(`alter table "chat_message_reactions" add constraint "chat_message_reactions_contact_uq" unique ("message_id", "external_contact_id", "emoji");`);
    this.addSql(`alter table "chat_message_reactions" add constraint "chat_message_reactions_identity_chk" check (num_nonnulls("user_id", "external_contact_id") = 1);`);
    this.addSql(`alter table "chat_message_reactions" add constraint "chat_message_reactions_external_contact_fk" foreign key ("external_contact_id", "tenant_id", "organization_id") references "chat_external_contacts" ("id", "tenant_id", "organization_id") on update no action on delete no action;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "chat_message_reactions" drop constraint if exists "chat_message_reactions_external_contact_fk";`);
    this.addSql(`alter table "chat_message_reactions" drop constraint if exists "chat_message_reactions_contact_uq";`);
    this.addSql(`alter table "chat_message_reactions" drop constraint if exists "chat_message_reactions_identity_chk";`);
    this.addSql(`alter table "chat_message_reactions" drop column "external_contact_id";`);
    this.addSql(`alter table "chat_message_reactions" alter column "user_id" set not null;`);

    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_sender_external_contact_fk";`);
    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_sender_chk";`);
    this.addSql(`alter table "chat_messages" drop column "sender_external_contact_id";`);
    this.addSql(`alter table "chat_messages" alter column "sender_user_id" set not null;`);

    this.addSql(`alter table "chat_participants" drop constraint if exists "chat_participants_external_conversation_fk";`);
    this.addSql(`alter table "chat_participants" drop constraint if exists "chat_participants_external_contact_fk";`);
    this.addSql(`alter table "chat_participants" drop constraint if exists "chat_participants_conversation_contact_uq";`);
    this.addSql(`alter table "chat_participants" drop constraint if exists "chat_participants_external_shape_chk";`);
    this.addSql(`alter table "chat_participants" drop constraint if exists "chat_participants_identity_chk";`);
    this.addSql(`alter table "chat_participants" drop column "external_contact_id", drop column "conversation_kind";`);
    this.addSql(`alter table "chat_participants" alter column "user_id" set not null;`);

    this.addSql(`alter table "chat_conversations" drop constraint if exists "chat_conversations_kind_shape_chk";`);
    this.addSql(`alter table "chat_conversations" drop constraint if exists "chat_conversations_id_kind_uq";`);
    this.addSql(`alter table "chat_conversations" add constraint "chat_conversations_kind_shape_chk" check (("kind" = 'direct' and "direct_key" is not null and "title" is null) or ("kind" = 'space' and "title" is not null and "direct_key" is null));`);

    this.addSql(`drop table if exists "chat_external_contacts";`);
  }

}
