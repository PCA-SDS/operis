import { Migration } from '@mikro-orm/migrations';

export class Migration20260914090249_resources extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "resources_assignments" add "assigned_member_ids" jsonb null;`);
    this.addSql(`update "resources_assignments"
      set "assigned_member_ids" = jsonb_build_array("assigned_member_id")
      where "assigned_member_id" is not null and "assigned_member_ids" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "resources_assignments" drop column "assigned_member_ids";`);
  }

}
