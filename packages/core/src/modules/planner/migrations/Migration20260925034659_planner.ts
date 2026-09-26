import { Migration } from '@mikro-orm/migrations';

export class Migration20260925034659_planner extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "planner_organization_availability_settings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "operating_hours_rule_set_id" uuid not null, "last_customer_before_close_minutes" int not null default 0, "time_overflow_minutes" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "planner_organization_availability_settings" add constraint "planner_org_availability_settings_scope_unique" unique ("tenant_id", "organization_id");`);
  }

}
