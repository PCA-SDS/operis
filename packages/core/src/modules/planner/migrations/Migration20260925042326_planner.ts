import { Migration } from '@mikro-orm/migrations';

export class Migration20260925042326_planner extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "planner_availability_rules" add "last_customer_before_close_minutes" int null, add "time_overflow_minutes" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "planner_availability_rules" drop column "last_customer_before_close_minutes", drop column "time_overflow_minutes";`);
  }

}
