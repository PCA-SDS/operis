import { Migration } from '@mikro-orm/migrations';

export class Migration20260826094035_catalog extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "catalog_product_variants" add "duration_value" int null, add "duration_unit" text null, add "duration_min" int null, add "duration_max" int null;`);

    this.addSql(`alter table "catalog_product_variant_prices" add "price_min" numeric(16,4) null, add "price_max" numeric(16,4) null;`);
    
    this.addSql(`update "catalog_products" set "product_type" = 'service' where "product_type" = 'virtual';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`update "catalog_products" set "product_type" = 'virtual' where "product_type" = 'service';`);

    this.addSql(`alter table "catalog_product_variant_prices" drop column "price_min", drop column "price_max";`);

    this.addSql(`alter table "catalog_product_variants" drop column "duration_value", drop column "duration_unit", drop column "duration_min", drop column "duration_max";`);
  }

}
