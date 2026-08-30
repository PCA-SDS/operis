import { Migration } from '@mikro-orm/migrations';

export class Migration20260826091542_invoice extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "invoice_companies" add constraint "invoice_companies_default_due_days_check" check ("default_due_days" is null or ("default_due_days" >= 0 and "default_due_days" <= 3650));`);

    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_email_tracking_hash_check" check ("email_tracking_token_hash" is null or "email_tracking_token_hash" ~ '^[0-9a-f]{64}\$');`);
    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_currency_code_check" check ("currency_code" in ('USD', 'EUR', 'GBP', 'SGD', 'AUD', 'JPY', 'CNY', 'KRW', 'THB', 'VND'));`);
    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_settlement_status_check" check ("settlement_status" in ('UNSETTLED', 'PARTIALLY_PAID', 'SETTLED'));`);
    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_invoice_status_check" check ("invoice_status" in ('ACTIVE', 'CANCELLED', 'REPLACEMENT', 'ADJUSTMENT', 'REPLACED', 'ADJUSTED'));`);
    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_direction_check" check ("direction" in ('AR', 'AP'));`);
    this.addSql(`alter table "invoice_invoices" add constraint "invoice_invoices_origin_check" check ("origin" in ('GOVERNMENT_PORTAL', 'MANUAL'));`);

    this.addSql(`alter table "invoice_installments" add constraint "invoice_installments_interest_rate_check" check ("interest_rate" >= 0 and "interest_rate" <= 100);`);
    this.addSql(`alter table "invoice_installments" add constraint "invoice_installments_status_check" check ("status" in ('PENDING', 'PAID'));`);

    this.addSql(`alter table "invoice_payment_confirmations" add constraint "invoice_payment_confirmations_token_hash_check" check ("token_hash" ~ '^[0-9a-f]{64}\$');`);
    this.addSql(`alter table "invoice_payment_confirmations" add constraint "invoice_payment_confirmations_status_check" check ("status" in ('PENDING', 'CONFIRMED', 'REJECTED'));`);

    this.addSql(`alter table "invoice_sync_jobs" add constraint "invoice_sync_jobs_progress_check" check ("progress" >= 0 and "progress" <= 100);`);
    this.addSql(`alter table "invoice_sync_jobs" add constraint "invoice_sync_jobs_failure_category_check" check ("failure_category" is null or "failure_category" in ('AUTH_FAILED', 'ACCOUNT_LOCKED', 'PORTAL_UNREACHABLE', 'INTERNAL_ERROR'));`);
    this.addSql(`alter table "invoice_sync_jobs" add constraint "invoice_sync_jobs_state_check" check ("state" in ('QUEUED', 'AUTHENTICATING', 'FETCHING', 'PERSISTING', 'DONE', 'FAILED'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "invoice_companies" drop constraint if exists "invoice_companies_default_due_days_check";`);

    this.addSql(`alter table "invoice_installments" drop constraint if exists "invoice_installments_interest_rate_check";`);
    this.addSql(`alter table "invoice_installments" drop constraint if exists "invoice_installments_status_check";`);

    this.addSql(`alter table "invoice_invoices" drop constraint if exists "invoice_invoices_email_tracking_hash_check";`);
    this.addSql(`alter table "invoice_invoices" drop constraint if exists "invoice_invoices_currency_code_check";`);
    this.addSql(`alter table "invoice_invoices" drop constraint if exists "invoice_invoices_settlement_status_check";`);
    this.addSql(`alter table "invoice_invoices" drop constraint if exists "invoice_invoices_invoice_status_check";`);
    this.addSql(`alter table "invoice_invoices" drop constraint if exists "invoice_invoices_direction_check";`);
    this.addSql(`alter table "invoice_invoices" drop constraint if exists "invoice_invoices_origin_check";`);

    this.addSql(`alter table "invoice_payment_confirmations" drop constraint if exists "invoice_payment_confirmations_token_hash_check";`);
    this.addSql(`alter table "invoice_payment_confirmations" drop constraint if exists "invoice_payment_confirmations_status_check";`);

    this.addSql(`alter table "invoice_sync_jobs" drop constraint if exists "invoice_sync_jobs_progress_check";`);
    this.addSql(`alter table "invoice_sync_jobs" drop constraint if exists "invoice_sync_jobs_failure_category_check";`);
    this.addSql(`alter table "invoice_sync_jobs" drop constraint if exists "invoice_sync_jobs_state_check";`);
  }

}
