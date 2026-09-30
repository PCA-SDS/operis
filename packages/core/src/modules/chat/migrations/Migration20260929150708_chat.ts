import { Migration } from '@mikro-orm/migrations';

/**
 * Messaging accounts: a company's (or an employee's) WhatsApp number connected
 * to Operis, the team its chats go to, the conversations that came in through
 * it, and messages sent from its phone. Spec:
 * `.ai/specs/2026-09-29-whatsapp-bridge.md`.
 *
 * Additive. No existing row names an account, so every existing row already
 * satisfies every CHECK added here, and nothing is backfilled.
 *
 * Three foreign keys are written by hand because the snapshot cannot express
 * composite keys. Each references `chat_messaging_accounts (id, tenant_id,
 * organization_id)`, so no row can name another organization's account:
 *
 * - `chat_messaging_account_members_account_fk` — `on delete cascade`: a team
 *   exists only with its account;
 * - `chat_conversations_messaging_account_fk` and
 *   `chat_messages_sender_account_fk` — `no action`: an account that has
 *   conversations or messages is soft-deleted, never removed.
 *
 * The down migration works only while no conversation or message references an
 * account — dropping the column would otherwise discard who wrote what.
 *
 * Encryption maps are seeded per tenant when the tenant is created, so a tenant
 * that already exists has none for these rows, and an account's name and number
 * — or a WhatsApp contact's name, now written automatically for every new chat —
 * would be stored as plain text. Both maps are backfilled for every scope that
 * already encrypts (the pattern `Migration20260722120000` set for device
 * tokens); a tenant with encryption off has no maps and gets none.
 */
export class Migration20260929150708_chat extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "chat_messaging_accounts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "network" text not null, "owner_type" text not null, "owner_user_id" uuid null, "display_name" text not null, "remote_handle" text null, "status" text not null default 'pending', "status_reason" text null, "show_sender_name" boolean not null default false, "login_step" jsonb null, "connected_at" timestamptz null, "connected_by_user_id" uuid null, "disconnected_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "chat_messaging_accounts_scope_idx" on "chat_messaging_accounts" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "chat_messaging_accounts" add constraint "chat_messaging_accounts_scope_uq" unique ("id", "tenant_id", "organization_id");`);
    this.addSql(`create unique index "chat_messaging_accounts_personal_uq" on "chat_messaging_accounts" ("tenant_id", "organization_id", "owner_user_id", "network") where "owner_type" = 'user' and "deleted_at" is null;`);

    this.addSql(`create table "chat_messaging_account_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "account_id" uuid not null, "user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "chat_messaging_account_members_user_idx" on "chat_messaging_account_members" ("tenant_id", "organization_id", "user_id");`);
    this.addSql(`alter table "chat_messaging_account_members" add constraint "chat_messaging_account_members_uq" unique ("account_id", "user_id");`);

    this.addSql(`alter table "chat_messaging_accounts" add constraint "chat_messaging_accounts_network_chk" check ("network" ~ '^[a-z][a-z0-9-]{0,31}\$');`);
    this.addSql(`alter table "chat_messaging_accounts" add constraint "chat_messaging_accounts_status_chk" check ("status" in ('pending', 'connecting', 'connected', 'disconnected', 'failed'));`);
    this.addSql(`alter table "chat_messaging_accounts" add constraint "chat_messaging_accounts_owner_chk" check ("owner_type" in ('company', 'user') and ("owner_type" = 'user') = ("owner_user_id" is not null));`);

    this.addSql(`alter table "chat_conversations" add "messaging_account_id" uuid null;`);
    this.addSql(`create index "chat_conversations_account_idx" on "chat_conversations" ("messaging_account_id") where "messaging_account_id" is not null;`);
    this.addSql(`alter table "chat_conversations" add constraint "chat_conversations_account_chk" check ("messaging_account_id" is null or "kind" = 'external');`);

    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_sender_chk";`);
    this.addSql(`alter table "chat_messages" add "sender_account_id" uuid null;`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_sender_chk" check (num_nonnulls("sender_user_id", "sender_external_contact_id", "sender_account_id") = 1 and (("sender_external_contact_id" is null and "sender_account_id" is null) or "kind" = 'user'));`);

    this.addSql(`alter table "chat_messaging_account_members" add constraint "chat_messaging_account_members_account_fk" foreign key ("account_id", "tenant_id", "organization_id") references "chat_messaging_accounts" ("id", "tenant_id", "organization_id") on update no action on delete cascade;`);
    this.addSql(`alter table "chat_conversations" add constraint "chat_conversations_messaging_account_fk" foreign key ("messaging_account_id", "tenant_id", "organization_id") references "chat_messaging_accounts" ("id", "tenant_id", "organization_id") on update no action on delete no action;`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_sender_account_fk" foreign key ("sender_account_id", "tenant_id", "organization_id") references "chat_messaging_accounts" ("id", "tenant_id", "organization_id") on update no action on delete no action;`);

    // On a fresh database this runs before `entities` has created
    // `encryption_maps` — and there is no tenant to backfill either; one created
    // later is seeded with both maps. Hence the guard.
    for (const [entityId, fields] of [
      ['chat:chat_messaging_account', '[{"field":"display_name"},{"field":"remote_handle"}]'],
      ['chat:chat_external_contact', '[{"field":"display_name"}]'],
    ] as const) {
      this.addSql(`do $$ begin
        if to_regclass('encryption_maps') is not null then
          insert into "encryption_maps" ("id", "entity_id", "tenant_id", "organization_id", "fields_json", "is_active", "created_at", "updated_at")
          select gen_random_uuid(), '${entityId}', src."tenant_id", src."organization_id", '${fields}'::jsonb, true, now(), now()
          from (
            select distinct "tenant_id", "organization_id"
            from "encryption_maps"
            where "is_active" = true and "deleted_at" is null
          ) src
          where not exists (
            select 1 from "encryption_maps" existing
            where existing."entity_id" = '${entityId}'
              and existing."tenant_id" is not distinct from src."tenant_id"
              and existing."organization_id" is not distinct from src."organization_id"
              and existing."deleted_at" is null
          );
        end if;
      end $$;`);
    }
  }

  override down(): void | Promise<void> {
    this.addSql(`do $$ begin
      if exists (select 1 from "chat_conversations" where "messaging_account_id" is not null)
         or exists (select 1 from "chat_messages" where "sender_account_id" is not null) then
        raise exception 'chat: conversations or messages still reference a messaging account; refusing to drop them';
      end if;
    end $$;`);
    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_sender_account_fk";`);
    this.addSql(`alter table "chat_conversations" drop constraint if exists "chat_conversations_messaging_account_fk";`);
    this.addSql(`alter table "chat_messaging_account_members" drop constraint if exists "chat_messaging_account_members_account_fk";`);

    this.addSql(`drop index if exists "chat_conversations_account_idx";`);
    this.addSql(`alter table "chat_conversations" drop constraint if exists "chat_conversations_account_chk";`);
    this.addSql(`alter table "chat_conversations" drop column "messaging_account_id";`);

    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_sender_chk";`);
    this.addSql(`alter table "chat_messages" drop column "sender_account_id";`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_sender_chk" check (num_nonnulls("sender_user_id", "sender_external_contact_id") = 1 and ("sender_external_contact_id" is null or "kind" = 'user'));`);

    this.addSql(`drop table if exists "chat_messaging_account_members" cascade;`);
    this.addSql(`drop table if exists "chat_messaging_accounts" cascade;`);
    // The account map has no source but this feature. The contact map stays:
    // contacts predate it, and a tenant created since has it from its seed.
    this.addSql(`do $$ begin
      if to_regclass('encryption_maps') is not null then
        delete from "encryption_maps" where "entity_id" = 'chat:chat_messaging_account';
      end if;
    end $$;`);
  }

}
