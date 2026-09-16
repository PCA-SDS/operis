import { Migration } from '@mikro-orm/migrations'

export class Migration20260915100000_invoice_sync_failure_request_id extends Migration {
  override up(): void | Promise<void> {
    this.addSql('alter table "invoice_sync_jobs" add column if not exists "failure_request_id" uuid null;')
  }

  override down(): void | Promise<void> {
    this.addSql('alter table "invoice_sync_jobs" drop column if exists "failure_request_id";')
  }
}
