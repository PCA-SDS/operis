import { Migration } from '@mikro-orm/migrations'

export class Migration20260910115000_appointments_line_category extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "appointment_lines" add column "product_category" text null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appointment_lines" drop column if exists "product_category";`)
  }
}
