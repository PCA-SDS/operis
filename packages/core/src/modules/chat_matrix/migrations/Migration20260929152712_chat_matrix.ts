import { Migration } from '@mikro-orm/migrations';

/**
 * Messaging accounts on the Matrix side. Spec: `.ai/specs/2026-09-29-whatsapp-bridge.md`.
 *
 * - `chat_matrix_account_logins` — one row per connected account: the identity
 *   that owns its bridge login, the login the bridge is running, and the state
 *   the bridge last reported. `account_id` and `mxid` are each unique: one
 *   identity per account, and one account per identity.
 * - `chat_matrix_rooms.account_id` — the account whose portal a room is, so
 *   replies in it are sent as that account.
 *
 * Additive, and still no `chat_*` table is touched. `down()` drops only what
 * this adds; rooms adopted from an account keep their conversation mapping.
 */
export class Migration20260929152712_chat_matrix extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "chat_matrix_account_logins" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "account_id" uuid not null, "owner_type" text not null, "network" text not null, "mxid" text not null, "registered_at" timestamptz null, "user_login_id" text null, "pending_login" jsonb null, "bridge_state" text null, "last_state_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "chat_matrix_account_logins_scope_idx" on "chat_matrix_account_logins" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "chat_matrix_account_logins" add constraint "chat_matrix_account_logins_mxid_uq" unique ("mxid");`);
    this.addSql(`alter table "chat_matrix_account_logins" add constraint "chat_matrix_account_logins_account_uq" unique ("account_id");`);

    this.addSql(`alter table "chat_matrix_rooms" add "account_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "chat_matrix_rooms" drop column "account_id";`);
    this.addSql(`drop table if exists "chat_matrix_account_logins" cascade;`);
  }

}
