import { Migration } from '@mikro-orm/migrations';

export class Migration20260903142415_email extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "email_accounting_defaults" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "default_sender_name" text null, "default_reply_to" text null, "placeholders" jsonb not null default '{}', "link_placeholders" jsonb not null default '{}', "rules" jsonb not null default '{}', "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "email_accounting_defaults" add constraint "email_accounting_defaults_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "email_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "template_key" text not null, "name" text not null, "description" text null, "category" text not null default 'accounting', "status" text not null default 'draft', "subject" text not null, "preheader" text null, "design" jsonb not null default '{}', "blocks" jsonb not null default '[]', "variables" jsonb not null default '[]', "accounting_metadata" jsonb null, "created_by_user_id" uuid null, "updated_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "email_templates_key_scope_unique_idx" on "email_templates" ("organization_id", "tenant_id", "template_key") where deleted_at is null;`);
    this.addSql(`create index "email_templates_updated_idx" on "email_templates" ("organization_id", "tenant_id", "updated_at");`);
    this.addSql(`create index "email_templates_category_status_idx" on "email_templates" ("organization_id", "tenant_id", "category", "status");`);
    this.addSql(`create index "email_templates_scope_idx" on "email_templates" ("organization_id", "tenant_id");`);
  }

}
