import { Migration } from '@mikro-orm/migrations';

export class Migration20260825105741_invoice extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "invoice_auto_paid_tax_codes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tax_code" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "invoice_auto_paid_tax_codes_scope_idx" on "invoice_auto_paid_tax_codes" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_auto_paid_tax_codes" add constraint "invoice_auto_paid_tax_codes_tax_code_scope_unique" unique ("organization_id", "tenant_id", "tax_code");`);

    this.addSql(`create table "invoice_companies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tax_code" text not null, "country_code" text not null default 'VN', "name" text not null, "default_due_days" int null default 30, "name_source_date" timestamptz null, "search_text" text not null default '', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "invoice_companies_name_idx" on "invoice_companies" ("organization_id", "tenant_id", "name");`);
    this.addSql(`create index "invoice_companies_scope_idx" on "invoice_companies" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_companies" add constraint "invoice_companies_tax_code_scope_unique" unique ("organization_id", "tenant_id", "tax_code");`);

    this.addSql(`create table "invoice_invoices" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "source_invoice_id" text not null, "origin" text not null default 'GOVERNMENT_PORTAL', "direction" text not null, "company_id" uuid not null, "seller_tax_code" text null, "seller_name" text not null, "buyer_tax_code" text null, "buyer_name" text not null, "invoice_symbol" text null, "invoice_number" text not null, "invoice_code" text null, "invoice_date" timestamptz not null, "due_date" timestamptz null, "due_date_source" text null, "currency_code" text not null default 'VND', "invoice_status" text not null default 'ACTIVE', "net_amount" numeric(18,4) null, "vat_amount" numeric(18,4) null, "gross_amount" numeric(18,4) not null, "has_received" boolean not null default false, "has_paid" boolean not null default false, "settlement_status" text not null default 'UNSETTLED', "paid_amount" numeric(18,4) not null default '0', "outstanding_amount" numeric(18,4) not null default '0', "next_due_date" timestamptz null, "has_installment_plan" boolean not null default false, "non_recoverable" boolean not null default false, "non_recoverable_note" text null, "non_recoverable_at" timestamptz null, "last_sent_at" timestamptz null, "email_tracking_token_hash" text null, "opened_at" timestamptz null, "auto_settled" boolean not null default false, "auto_pay_excluded" boolean not null default false, "search_text" text not null default '', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "invoice_invoices_next_due_date_idx" on "invoice_invoices" ("organization_id", "tenant_id", "next_due_date");`);
    this.addSql(`create index "invoice_invoices_due_date_idx" on "invoice_invoices" ("organization_id", "tenant_id", "due_date");`);
    this.addSql(`create index "invoice_invoices_settlement_idx" on "invoice_invoices" ("organization_id", "tenant_id", "settlement_status", "invoice_date");`);
    this.addSql(`create index "invoice_invoices_date_idx" on "invoice_invoices" ("organization_id", "tenant_id", "invoice_date", "id");`);
    this.addSql(`create index "invoice_invoices_company_idx" on "invoice_invoices" ("company_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "invoice_invoices_direction_idx" on "invoice_invoices" ("organization_id", "tenant_id", "direction");`);
    this.addSql(`create index "invoice_invoices_scope_idx" on "invoice_invoices" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_email_tracking_hash_unique" unique ("email_tracking_token_hash");`);
    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_source_scope_unique" unique ("organization_id", "tenant_id", "source_invoice_id");`);

    this.addSql(`create table "invoice_company_emails" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "company_id" uuid not null, "email" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "invoice_company_emails_company_idx" on "invoice_company_emails" ("company_id");`);
    this.addSql(`create index "invoice_company_emails_scope_idx" on "invoice_company_emails" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_company_emails" add constraint "invoice_company_emails_company_email_unique" unique ("company_id", "email");`);

    this.addSql(`create table "invoice_company_registry" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "country_code" text not null, "identifier" text not null, "provider" text not null, "payload" jsonb not null, "fetched_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "invoice_company_registry_fetched_at_idx" on "invoice_company_registry" ("organization_id", "tenant_id", "fetched_at");`);
    this.addSql(`create index "invoice_company_registry_scope_idx" on "invoice_company_registry" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_company_registry" add constraint "invoice_company_registry_lookup_unique" unique ("organization_id", "tenant_id", "country_code", "provider", "identifier");`);

    this.addSql(`create table "invoice_installments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "invoice_id" uuid not null, "sequence" int not null, "principal_amount" numeric(18,4) not null, "interest_rate" numeric(7,4) not null default '0', "interest_amount" numeric(18,4) not null default '0', "total_amount" numeric(18,4) not null, "due_date" timestamptz not null, "status" text not null default 'PENDING', "paid_at" timestamptz null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "invoice_installments_due_date_idx" on "invoice_installments" ("organization_id", "tenant_id", "due_date");`);
    this.addSql(`create index "invoice_installments_invoice_idx" on "invoice_installments" ("invoice_id");`);
    this.addSql(`create index "invoice_installments_scope_idx" on "invoice_installments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_installments" add constraint "invoice_installments_invoice_sequence_unique" unique ("invoice_id", "sequence");`);

    this.addSql(`create table "invoice_invoice_line_items" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "invoice_id" uuid not null, "line_number" int not null, "name" text not null, "unit" text null, "quantity" numeric(18,4) null, "unit_price" numeric(18,4) null, "discount_amount" numeric(18,4) null, "discount_percent" numeric(7,4) null, "vat_rate" numeric(7,4) null, "vat_amount" numeric(18,4) null, "line_total" numeric(18,4) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "invoice_invoice_line_items_invoice_idx" on "invoice_invoice_line_items" ("invoice_id");`);
    this.addSql(`create index "invoice_invoice_line_items_scope_idx" on "invoice_invoice_line_items" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_invoice_line_items" add constraint "invoice_invoice_line_items_invoice_line_unique" unique ("invoice_id", "line_number");`);

    this.addSql(`create table "invoice_payment_confirmations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "invoice_id" uuid not null, "installment_id" uuid null, "recipient_email" text not null, "token_hash" text not null, "status" text not null default 'PENDING', "expires_at" timestamptz not null, "confirmed_at" timestamptz null, "rejected_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "invoice_payment_confirmations_installment_idx" on "invoice_payment_confirmations" ("installment_id");`);
    this.addSql(`create index "invoice_payment_confirmations_invoice_idx" on "invoice_payment_confirmations" ("invoice_id");`);
    this.addSql(`create index "invoice_payment_confirmations_scope_idx" on "invoice_payment_confirmations" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_payment_confirmations" add constraint "invoice_payment_confirmations_token_hash_unique" unique ("token_hash");`);

    this.addSql(`create table "invoice_sync_jobs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "from_date" timestamptz not null, "to_date" timestamptz not null, "scope_tax_codes" jsonb not null default '[]', "idempotency_key" text not null, "started_by_user_id" uuid null, "state" text not null default 'QUEUED', "progress" int not null default 0, "progress_job_id" uuid null, "counts" jsonb not null default '{}', "failure_category" text null, "failure_message" text null, "created_at" timestamptz not null, "started_at" timestamptz null, "updated_at" timestamptz not null, "finished_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "invoice_sync_jobs_created_at_idx" on "invoice_sync_jobs" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index "invoice_sync_jobs_state_idx" on "invoice_sync_jobs" ("organization_id", "tenant_id", "state");`);
    this.addSql(`create index "invoice_sync_jobs_scope_idx" on "invoice_sync_jobs" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "invoice_sync_jobs" add constraint "invoice_sync_jobs_idempotency_scope_unique" unique ("organization_id", "tenant_id", "idempotency_key");`);

    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_company_id_foreign" foreign key ("company_id") references "invoice_companies" ("id") on delete restrict;`);

    this.addSql(`alter table "invoice_company_emails" add constraint "invoice_company_emails_company_id_foreign" foreign key ("company_id") references "invoice_companies" ("id") on delete cascade;`);

    this.addSql(`alter table "invoice_installments" add constraint "invoice_installments_invoice_id_foreign" foreign key ("invoice_id") references "invoice_invoices" ("id") on delete cascade;`);

    this.addSql(`alter table "invoice_invoice_line_items" add constraint "invoice_invoice_line_items_invoice_id_foreign" foreign key ("invoice_id") references "invoice_invoices" ("id") on delete cascade;`);

    this.addSql(`alter table "invoice_payment_confirmations" add constraint "invoice_payment_confirmations_invoice_id_foreign" foreign key ("invoice_id") references "invoice_invoices" ("id") on delete cascade;`);
    this.addSql(`alter table "invoice_payment_confirmations" add constraint "invoice_payment_confirmations_installment_id_foreign" foreign key ("installment_id") references "invoice_installments" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "invoice_payment_confirmations";`);
    this.addSql(`drop table if exists "invoice_invoice_line_items";`);
    this.addSql(`drop table if exists "invoice_installments";`);
    this.addSql(`drop table if exists "invoice_invoices";`);
    this.addSql(`drop table if exists "invoice_company_emails";`);
    this.addSql(`drop table if exists "invoice_company_registry";`);
    this.addSql(`drop table if exists "invoice_sync_jobs";`);
    this.addSql(`drop table if exists "invoice_auto_paid_tax_codes";`);
    this.addSql(`drop table if exists "invoice_companies";`);
  }

}
