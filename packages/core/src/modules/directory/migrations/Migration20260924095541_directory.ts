import { Migration } from '@mikro-orm/migrations';

export class Migration20260924095541_directory extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "directory_user_organization_memberships" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "user_id" uuid not null, "organization_id" uuid not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "directory_user_org_memberships_org_idx" on "directory_user_organization_memberships" ("tenant_id", "organization_id");`);
    this.addSql(`create index "directory_user_org_memberships_user_idx" on "directory_user_organization_memberships" ("tenant_id", "user_id");`);
    this.addSql(`alter table "directory_user_organization_memberships" add constraint "directory_user_org_memberships_user_org_uniq" unique ("tenant_id", "user_id", "organization_id");`);
    this.addSql(`insert into "directory_user_organization_memberships" ("tenant_id", "user_id", "organization_id", "is_active", "created_at", "updated_at") select "tenant_id", "id", "organization_id", true, now(), now() from "users" where "tenant_id" is not null and "organization_id" is not null and "deleted_at" is null on conflict ("tenant_id", "user_id", "organization_id") do nothing;`);
  }

}
