import { Migration } from '@mikro-orm/migrations'

export class Migration20260911120000_invoice_sync extends Migration {
  override up(): void | Promise<void> {
    this.addSql('alter table "organizations" add column if not exists "tax_code" text null;')
    this.addSql('create unique index if not exists "invoice_sync_jobs_one_active_scope_idx" on "invoice_sync_jobs" ("organization_id", "tenant_id") where "state" in (\'QUEUED\',\'AUTHENTICATING\',\'FETCHING\',\'PERSISTING\');')
  }
  override down(): void | Promise<void> {
    this.addSql('drop index if exists "invoice_sync_jobs_one_active_scope_idx";')
    this.addSql('alter table "organizations" drop column if exists "tax_code";')
  }
}
