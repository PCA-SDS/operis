import { Migration } from '@mikro-orm/migrations';

export class Migration20260825094847_appointments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "appointment_statuses" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "is_system" boolean not null default false, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "appointment_statuses_tenant_idx" on "appointment_statuses" ("tenant_id");`);
    this.addSql(`alter table "appointment_statuses" add constraint "appointment_statuses_tenant_code_unique" unique ("tenant_id", "code");`);

    this.addSql(`create table "appointments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "customer_entity_id" uuid not null, "customer_name" text not null, "customer_salutation" text null, "customer_email" text null, "customer_phone" text null, "customer_phone_country_code" text null, "customer_phone_country" text null, "status_id" uuid not null, "status_code" text not null, "requested_start_at" timestamptz not null, "requested_end_at" timestamptz null, "notes" text null, "external_notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "appointments_customer_idx" on "appointments" ("tenant_id", "customer_entity_id");`);
    this.addSql(`create index "appointments_requested_start_idx" on "appointments" ("tenant_id", "organization_id", "requested_start_at");`);
    this.addSql(`create index "appointments_tenant_org_idx" on "appointments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "appointment_lines" ("id" uuid not null default gen_random_uuid(), "appointment_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "product_title" text not null, "product_handle" text null, "currency_code" text null, "unit_price_net" numeric(16,4) null, "unit_price_gross" numeric(16,4) null, "duration_minutes" int null, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "appointment_lines_tenant_org_idx" on "appointment_lines" ("tenant_id", "organization_id");`);
    this.addSql(`create index "appointment_lines_appointment_idx" on "appointment_lines" ("appointment_id");`);

    this.addSql(`alter table "appointments" add constraint "appointments_status_id_foreign" foreign key ("status_id") references "appointment_statuses" ("id") on delete restrict;`);

    this.addSql(`alter table "appointment_lines" add constraint "appointment_lines_appointment_id_foreign" foreign key ("appointment_id") references "appointments" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appointment_lines" drop constraint if exists "appointment_lines_appointment_id_foreign";`);
    this.addSql(`alter table "appointments" drop constraint if exists "appointments_status_id_foreign";`);
    this.addSql(`drop table if exists "appointment_lines" cascade;`);
    this.addSql(`drop table if exists "appointments" cascade;`);
    this.addSql(`drop table if exists "appointment_statuses" cascade;`);
  }

}
