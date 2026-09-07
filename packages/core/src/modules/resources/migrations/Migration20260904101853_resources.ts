import { Migration } from '@mikro-orm/migrations';

export class Migration20260904101853_resources extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "resources_resource_area_types" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "resources_resource_area_types_tenant_org_idx" on "resources_resource_area_types" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "resources_resource_areas" drop column "area_type";`);
    this.addSql(`alter table "resources_resource_areas" add "area_type_id" uuid null;`);
    this.addSql(`alter table "resources_resource_areas" add constraint "resources_resource_areas_area_type_id_foreign" foreign key ("area_type_id") references "resources_resource_area_types" ("id") on delete set null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "resources_resource_areas" drop constraint if exists "resources_resource_areas_area_type_id_foreign";`);

    this.addSql(`alter table "resources_resource_areas" drop column "area_type_id";`);
    this.addSql(`alter table "resources_resource_areas" add "area_type" text not null default 'other';`);
  }

}
