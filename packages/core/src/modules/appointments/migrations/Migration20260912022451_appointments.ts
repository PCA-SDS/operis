import { Migration } from '@mikro-orm/migrations';

export class Migration20260912022451_appointments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "appointment_line_option_groups" rename column "is_rootGroup" to "is_root_group";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appointment_line_option_groups" rename column "is_root_group" to "is_rootGroup";`);
  }

}
