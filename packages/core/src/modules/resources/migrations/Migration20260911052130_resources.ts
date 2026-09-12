import { Migration } from '@mikro-orm/migrations';

export class Migration20260911052130_resources extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "resources_blocks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "resource_id" uuid null, "starts_at" timestamptz not null, "ends_at" timestamptz not null, "reason" text null, "created_by_user_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "rb_resource_time_idx" on "resources_blocks" ("resource_id", "starts_at", "ends_at");`);

    this.addSql(`create table "resources_assignments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "source_module" text not null, "source_entity_type" text not null, "source_entity_id" uuid not null, "resource_id" uuid null, "state" text not null, "starts_at" timestamptz not null, "ends_at" timestamptz not null, "assigned_member_id" uuid null, "title" text null, "cancelled_at" timestamptz null, "created_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ra_state_idx" on "resources_assignments" ("state", "cancelled_at");`);
    this.addSql(`create index "ra_source_entity_idx" on "resources_assignments" ("source_entity_id");`);
    this.addSql(`create index "ra_source_module_idx" on "resources_assignments" ("source_module", "source_entity_type", "source_entity_id");`);
    this.addSql(`create index "ra_resource_time_idx" on "resources_assignments" ("resource_id", "starts_at", "ends_at");`);
    this.addSql(`create index "ra_tenant_org_idx" on "resources_assignments" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "resources_blocks" add constraint "resources_blocks_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on delete set null;`);

    this.addSql(`alter table "resources_assignments" add constraint "resources_assignments_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on delete set null;`);
  }

}
