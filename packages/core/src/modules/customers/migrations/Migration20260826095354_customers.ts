import { Migration } from '@mikro-orm/migrations';

export class Migration20260826095354_customers extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_companies" add "tax_code" text null, add "registration_country" text null, add "address" text null, add "incorporation_date" date null, add "client_tier" text null, add "onboarded_at" date null, add "registered_at" date null, add "end_date" date null, add "reactivated_at" timestamptz null;`);
    this.addSql(`create unique index "customer_companies_tenant_tax_code_uq" on "customer_companies" ("tenant_id", "tax_code") where "tax_code" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "customer_companies_tenant_tax_code_uq";`);
    this.addSql(`alter table "customer_companies" drop column "tax_code", drop column "registration_country", drop column "address", drop column "incorporation_date", drop column "client_tier", drop column "onboarded_at", drop column "registered_at", drop column "end_date", drop column "reactivated_at";`);
  }

}
