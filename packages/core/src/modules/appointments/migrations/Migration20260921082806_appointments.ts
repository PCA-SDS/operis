import { Migration } from '@mikro-orm/migrations';

export class Migration20260921082806_appointments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "appointment_lines" add "seat_planner_cleared_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appointment_lines" drop column "seat_planner_cleared_at";`);
  }

}
