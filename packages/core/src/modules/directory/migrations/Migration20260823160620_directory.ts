import { Migration } from '@mikro-orm/migrations';

export class Migration20260823160620_directory extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "tenant_modules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "module_id" text not null, "is_enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tenant_modules_tenant_idx" on "tenant_modules" ("tenant_id");`);
    this.addSql(`alter table "tenant_modules" add constraint "tenant_modules_tenant_module_uniq" unique ("tenant_id", "module_id");`);

    this.addSql(`alter table "tenant_modules" add constraint "tenant_modules_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "tenant_modules" cascade;`);
  }

}
