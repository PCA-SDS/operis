import { Migration } from '@mikro-orm/migrations'

export class Migration20260825184500_customers_origin extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_entities" add column "origin" text null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_entities" drop column if exists "origin";`)
  }
}
