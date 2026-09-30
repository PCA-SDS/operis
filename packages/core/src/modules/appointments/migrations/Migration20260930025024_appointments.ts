import { Migration } from '@mikro-orm/migrations';

export class Migration20260930025024_appointments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create extension if not exists "pg_trgm";`);
    this.addSql(`create index "appointments_customer_phone_digits_trgm_idx" on "appointments" using gin (regexp_replace(coalesce("customer_phone", ''), '[^0-9]', '', 'g') gin_trgm_ops) where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "appointments_customer_phone_digits_trgm_idx";`);
  }

}
