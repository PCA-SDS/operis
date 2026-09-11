import { Migration } from '@mikro-orm/migrations'

export class Migration20260910153000_appointments_line_options extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "appointment_lines" add column "selected_options" jsonb null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "appointment_lines" drop column "selected_options";`,
    )
  }
}
