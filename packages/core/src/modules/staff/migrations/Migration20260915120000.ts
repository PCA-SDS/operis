import { Migration } from '@mikro-orm/migrations';

export class Migration20260915120000 extends Migration {

  override async up(): Promise<void> {
    // `role_ids` is filtered with jsonb containment (`role_ids @> '[...]'`), which
    // btree cannot serve — filtering Team Members by role, and the per-role member
    // counts on Team Roles, re-checked every row in the tenant. jsonb_path_ops is
    // the compact GIN opclass for exactly this operator.
    this.addSql(
      `create index "staff_team_members_role_ids_gin" on "staff_team_members" using gin ("role_ids" jsonb_path_ops) where "deleted_at" is null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "staff_team_members_role_ids_gin";`);
  }

}
