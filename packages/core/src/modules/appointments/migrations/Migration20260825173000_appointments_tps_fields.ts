import { Migration } from '@mikro-orm/migrations'

export class Migration20260825173000_appointments_tps_fields extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "appointments" add column "customer_origin" text null;`)
    this.addSql(`alter table "appointments" add column "booking_type" text null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appointments" drop column if exists "booking_type";`)
    this.addSql(`alter table "appointments" drop column if exists "customer_origin";`)
  }
}
