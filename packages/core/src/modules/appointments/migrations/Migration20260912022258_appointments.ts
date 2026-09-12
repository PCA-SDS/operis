import { Migration } from '@mikro-orm/migrations';

export class Migration20260912022258_appointments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "appointment_line_option_groups" ("id" uuid not null default gen_random_uuid(), "line_id" uuid not null, "catalog_group_id" uuid null, "parent_option_id" uuid null, "group_name" text not null, "requirement" text not null default 'optional', "select_mode" text not null default 'single', "sort_order" int not null default 0, "breadcrumb_path" text null, "is_rootGroup" boolean not null default false, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "alog_option_groups_catalog_group_idx" on "appointment_line_option_groups" ("catalog_group_id");`);
    this.addSql(`create index "alog_option_groups_line_idx" on "appointment_line_option_groups" ("line_id");`);

    this.addSql(`create table "appointment_line_options" ("id" uuid not null default gen_random_uuid(), "group_id" uuid not null, "catalog_option_id" uuid null, "option_name" text not null, "code" text null, "note" text null, "price_flat" numeric(15,2) null, "price_min" numeric(15,2) null, "price_max" numeric(15,2) null, "duration_value" int null, "duration_unit" text null, "is_addon" boolean not null default false, "sort_order" int not null default 0, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "alo_options_catalog_option_idx" on "appointment_line_options" ("catalog_option_id");`);
    this.addSql(`create index "alo_options_group_idx" on "appointment_line_options" ("group_id");`);

    this.addSql(`alter table "appointment_line_option_groups" add constraint "appointment_line_option_groups_line_id_foreign" foreign key ("line_id") references "appointment_lines" ("id") on delete cascade;`);

    this.addSql(`alter table "appointment_line_options" add constraint "appointment_line_options_group_id_foreign" foreign key ("group_id") references "appointment_line_option_groups" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appointment_line_options" drop constraint if exists "appointment_line_options_group_id_foreign";`);
  }

}
