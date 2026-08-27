import { Migration } from '@mikro-orm/migrations';

export class Migration20260827000000_catalog_constraint extends Migration {

  override up(): void | Promise<void> {
    // Drop first in case a previous partial migration left a table with wrong schema
    this.addSql(`DROP TABLE IF EXISTS "catalog_product_constraints" CASCADE;`);

    this.addSql(`
      CREATE TABLE "catalog_product_constraints" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "constraint_type" text NOT NULL,
        "source_product_id" uuid NULL,
        "source_option_id" uuid NULL,
        "target_product_id" uuid NULL,
        "target_option_id" uuid NULL,
        "locked" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        PRIMARY KEY ("id"),

        CONSTRAINT "catalog_product_constraints_source_product_fk"
          FOREIGN KEY ("source_product_id")
          REFERENCES "catalog_products"("id")
          ON DELETE CASCADE,

        CONSTRAINT "catalog_product_constraints_source_option_fk"
          FOREIGN KEY ("source_option_id")
          REFERENCES "catalog_product_options"("id")
          ON DELETE CASCADE,

        CONSTRAINT "catalog_product_constraints_target_product_fk"
          FOREIGN KEY ("target_product_id")
          REFERENCES "catalog_products"("id")
          ON DELETE CASCADE,

        CONSTRAINT "catalog_product_constraints_target_option_fk"
          FOREIGN KEY ("target_option_id")
          REFERENCES "catalog_product_options"("id")
          ON DELETE CASCADE,

        CONSTRAINT "catalog_product_constraints_exactly_one_source"
          CHECK (
            (CASE WHEN "source_product_id" IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN "source_option_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
          ),

        CONSTRAINT "catalog_product_constraints_exactly_one_target"
          CHECK (
            (CASE WHEN "target_product_id" IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN "target_option_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
          )
      );
    `);

    this.addSql(`
      CREATE INDEX "catalog_product_constraints_scope_idx"
        ON "catalog_product_constraints" ("tenant_id", "organization_id");
    `);

    this.addSql(`
      CREATE INDEX "catalog_product_constraints_source_idx"
        ON "catalog_product_constraints" ("source_product_id", "source_option_id");
    `);

    this.addSql(`
      CREATE INDEX "catalog_product_constraints_target_idx"
        ON "catalog_product_constraints" ("target_product_id", "target_option_id");
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "catalog_product_constraints" CASCADE;`);
  }

}
