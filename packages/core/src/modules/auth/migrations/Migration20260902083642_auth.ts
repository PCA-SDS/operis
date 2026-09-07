import { Migration } from '@mikro-orm/migrations';

export class Migration20260902083642_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "roles" add "parent_role_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "roles" drop column "parent_role_id";`);
  }

}
