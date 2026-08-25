import { Migration } from '@mikro-orm/migrations'

export class Migration20260825114500_customers_tps_crm extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_entities" add column "phone_country_code" text null;`)
    this.addSql(`alter table "customer_entities" add column "phone_country" text null;`)
    this.addSql(`alter table "customer_people" add column "salutation" text null;`)
    this.addSql(
      `create unique index "customer_entities_tenant_phone_uq" on "customer_entities" ("tenant_id", "phone_country_code", "primary_phone") where "deleted_at" is null and "kind" = 'person' and "primary_phone" is not null and "phone_country_code" is not null;`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "customer_entities_tenant_phone_uq";`)
    this.addSql(`alter table "customer_people" drop column if exists "salutation";`)
    this.addSql(`alter table "customer_entities" drop column if exists "phone_country";`)
    this.addSql(`alter table "customer_entities" drop column if exists "phone_country_code";`)
  }
}
