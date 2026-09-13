import { Migration } from '@mikro-orm/migrations';

export class Migration20260903015613_resources extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "resources_resource_areas" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "area_type" text not null default 'other', "parent_area_id" uuid null, "sort_order" int not null default 0, "appearance_icon" text null, "appearance_color" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "resources_resource_areas_parent_idx" on "resources_resource_areas" ("parent_area_id");`);
    this.addSql(`create index "resources_resource_areas_tenant_org_idx" on "resources_resource_areas" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "resources_resources" add "area_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "resources_resources" drop column "area_id";`);
    this.addSql(`drop table "resources_resource_areas";`);
  }
}
