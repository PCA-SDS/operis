import { Migration } from '@mikro-orm/migrations';

export class Migration20260826015211_catalog extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`drop table if exists "catalog_product_variant_option_values" cascade;`);
    this.addSql(`drop table if exists "catalog_product_option_values" cascade;`);
    this.addSql(`drop table if exists "catalog_product_options" cascade;`);

    this.addSql(`create table "catalog_product_option_groups" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "parent_option_id" uuid null, "name" text not null, "description" text null, "requirement" text not null default 'required', "select_mode" text not null default 'single', "sort_order" int not null default 0, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_option_groups_product_idx" on "catalog_product_option_groups" ("product_id", "tenant_id", "sort_order");`);

    this.addSql(`create table "catalog_product_options" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "group_id" uuid not null, "code" text null, "name" text not null, "description" text null, "note" text null, "unit" text null, "price_flat" numeric(15,2) null, "price_min" numeric(15,2) null, "price_max" numeric(15,2) null, "duration_value" int null, "duration_unit" text null, "duration_min" int null, "duration_max" int null, "is_addon" boolean not null default false, "sort_order" int not null default 0, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_options_group_idx" on "catalog_product_options" ("group_id", "sort_order");`);
    this.addSql(`alter table "catalog_product_options" add constraint "catalog_product_options_code_scope_unique" unique ("tenant_id", "organization_id", "group_id", "code");`);

    this.addSql(`alter table "catalog_product_option_groups" add constraint "catalog_product_option_groups_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on delete cascade;`);
    this.addSql(`alter table "catalog_product_option_groups" add constraint "catalog_product_option_groups_parent_option_id_foreign" foreign key ("parent_option_id") references "catalog_product_options" ("id") on delete cascade;`);

    this.addSql(`alter table "catalog_product_options" add constraint "catalog_product_options_group_id_foreign" foreign key ("group_id") references "catalog_product_option_groups" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "catalog_product_options" drop constraint if exists "catalog_product_options_group_id_foreign";`);
    this.addSql(`alter table "catalog_product_option_groups" drop constraint if exists "catalog_product_option_groups_parent_option_id_foreign";`);
    this.addSql(`alter table "catalog_product_option_groups" drop constraint if exists "catalog_product_option_groups_product_id_foreign";`);

    this.addSql(`drop table if exists "catalog_product_options" cascade;`);
    this.addSql(`drop table if exists "catalog_product_option_groups" cascade;`);
  }

}
