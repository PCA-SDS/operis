import { Migration } from '@mikro-orm/migrations';

export class Migration20260824120000_mcp extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "mcp_oauth_clients" ("id" uuid not null default gen_random_uuid(), "client_id" text not null, "client_name" text not null, "client_secret_hash" text null, "redirect_uris" jsonb not null, "allowed_scopes" jsonb not null, "registration_source" text not null, "tenant_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "mcp_oauth_clients" add constraint "mcp_oauth_clients_client_id_uq" unique ("client_id");`);
    this.addSql(`alter table "mcp_oauth_clients" add constraint "mcp_oauth_clients_registration_source_check" check ("registration_source" in ('preconfigured', 'dynamic', 'cimd'));`);
    this.addSql(`create index "mcp_oauth_clients_tenant_idx" on "mcp_oauth_clients" ("tenant_id");`);

    this.addSql(`create table "mcp_oauth_authorization_codes" ("id" uuid not null default gen_random_uuid(), "code_hash" text not null, "client_id" text not null, "user_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "scopes" jsonb not null, "redirect_uri" text not null, "code_challenge" text not null, "code_challenge_method" text not null, "resource" text not null, "expires_at" timestamptz not null, "consumed_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "mcp_oauth_authorization_codes" add constraint "mcp_oauth_authorization_codes_code_hash_uq" unique ("code_hash");`);
    this.addSql(`create index "mcp_oauth_authorization_codes_expires_at_index" on "mcp_oauth_authorization_codes" ("expires_at");`);
    this.addSql(`create index "mcp_oauth_authorization_codes_client_user_idx" on "mcp_oauth_authorization_codes" ("client_id", "user_id");`);

    this.addSql(`create table "mcp_oauth_refresh_tokens" ("id" uuid not null default gen_random_uuid(), "token_hash" text not null, "grant_id" uuid not null, "client_id" text not null, "user_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "scopes" jsonb not null, "resource" text not null, "expires_at" timestamptz not null, "rotated_at" timestamptz null, "revoked_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "mcp_oauth_refresh_tokens" add constraint "mcp_oauth_refresh_tokens_token_hash_uq" unique ("token_hash");`);
    this.addSql(`create index "mcp_oauth_refresh_tokens_grant_id_index" on "mcp_oauth_refresh_tokens" ("grant_id");`);
    this.addSql(`create index "mcp_oauth_refresh_tokens_expires_at_index" on "mcp_oauth_refresh_tokens" ("expires_at");`);
    this.addSql(`create index "mcp_oauth_refresh_tokens_client_user_idx" on "mcp_oauth_refresh_tokens" ("client_id", "user_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "mcp_oauth_refresh_tokens" cascade;`);
    this.addSql(`drop table if exists "mcp_oauth_authorization_codes" cascade;`);
    this.addSql(`drop table if exists "mcp_oauth_clients" cascade;`);
  }

}
