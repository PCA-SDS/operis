import { Migration } from '@mikro-orm/migrations';

export class Migration20260915014859_appointments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "appointment_statuses" add "background_color" text null, add "text_color" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appointment_statuses" drop column "background_color", drop column "text_color";`);
  }

}
