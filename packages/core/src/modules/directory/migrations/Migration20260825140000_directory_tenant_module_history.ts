import { Migration } from '@mikro-orm/migrations';

/**
 * Grant history and the AI sub-toggle on `tenant_modules`.
 *
 * `starts_at` / `ends_at` turn a boolean into a record: revocation stamps
 * `ends_at` and keeps the row, so "when did this tenant have this module" stays
 * answerable for billing. Existing rows are backfilled from `created_at` — the
 * only honest approximation of when the grant began — so the entitlement screen
 * has a date to show instead of a blank for every pre-existing grant.
 *
 * `ai_assistant_enabled` defaults false: a tenant that already holds a module
 * must not silently gain its AI assistant when the column appears.
 */
export class Migration20260825140000_directory_tenant_module_history extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "tenant_modules" add column "starts_at" timestamptz null;`);
    this.addSql(`alter table "tenant_modules" add column "ends_at" timestamptz null;`);
    this.addSql(`alter table "tenant_modules" add column "ai_assistant_enabled" boolean not null default false;`);

    this.addSql(`update "tenant_modules" set "starts_at" = "created_at" where "is_enabled" = true and "starts_at" is null;`);
    this.addSql(`update "tenant_modules" set "ends_at" = "updated_at" where "is_enabled" = false and "ends_at" is null and "updated_at" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "tenant_modules" drop column if exists "ai_assistant_enabled";`);
    this.addSql(`alter table "tenant_modules" drop column if exists "ends_at";`);
    this.addSql(`alter table "tenant_modules" drop column if exists "starts_at";`);
  }

}
