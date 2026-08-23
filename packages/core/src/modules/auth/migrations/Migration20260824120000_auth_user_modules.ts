import { Migration } from '@mikro-orm/migrations';

export class Migration20260824120000_auth_user_modules extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "user_modules" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "module_id" text not null, "is_enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "user_modules_pkey" primary key ("id"));`);
    this.addSql(`create index "user_modules_tenant_idx" on "user_modules" ("tenant_id");`);
    this.addSql(`alter table "user_modules" add constraint "user_modules_user_module_uniq" unique ("user_id", "module_id");`);

    this.addSql(`alter table "user_modules" add constraint "user_modules_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "user_modules" cascade;`);
  }

}
