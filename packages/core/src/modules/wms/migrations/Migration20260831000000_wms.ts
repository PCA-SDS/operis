import { Migration } from '@mikro-orm/migrations';

/**
 * `SalesOrderWarehouseAssignment.warehouse` is a required `@ManyToOne`, but no
 * migration ever created the matching foreign key — the table shipped with a
 * primary key and nothing else, so `warehouse_id` could reference a warehouse
 * that does not exist. The module snapshot recorded a constraint named
 * `wms_sowa_warehouse_id_foreign` that was never created, which is why
 * `db:generate` kept emitting drift for this module.
 *
 * Added `NOT VALID`: Postgres enforces the constraint on every new row and
 * every update without scanning the existing table, so this cannot fail on a
 * deployment that already carries orphaned assignments. Once such rows are
 * reconciled, promote it with:
 *
 *   ALTER TABLE "wms_sales_order_warehouse_assignments"
 *     VALIDATE CONSTRAINT "wms_sales_order_warehouse_assignments_warehouse_id_foreign";
 */
export class Migration20260831000000_wms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_sales_order_warehouse_assignments" drop constraint if exists "wms_sowa_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_sales_order_warehouse_assignments" drop constraint if exists "wms_sales_order_warehouse_assignments_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_sales_order_warehouse_assignments" add constraint "wms_sales_order_warehouse_assignments_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id") not valid;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_sales_order_warehouse_assignments" drop constraint if exists "wms_sales_order_warehouse_assignments_warehouse_id_foreign";`);
  }

}
