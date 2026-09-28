import { Migration } from '@mikro-orm/migrations';

export class Migration20260925044158_planner extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "planner_availability_rules" add "last_customer_acceptance_minutes" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "planner_availability_rules" drop column "last_customer_acceptance_minutes";`);
  }

}
