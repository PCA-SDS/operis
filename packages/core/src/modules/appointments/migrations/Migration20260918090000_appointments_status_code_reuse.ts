import { Migration } from '@mikro-orm/migrations'

export class Migration20260918090000_appointments_status_code_reuse extends Migration {
  override up(): void | Promise<void> {
    this.addSql('alter table "appointment_statuses" drop constraint if exists "appointment_statuses_tenant_code_unique";')
    this.addSql(
      'create unique index "appointment_statuses_tenant_code_unique" on "appointment_statuses" ("tenant_id", "code") where "deleted_at" is null;',
    )
  }

  override down(): void | Promise<void> {
    this.addSql('drop index if exists "appointment_statuses_tenant_code_unique";')
    this.addSql(
      'alter table "appointment_statuses" add constraint "appointment_statuses_tenant_code_unique" unique ("tenant_id", "code");',
    )
  }
}
