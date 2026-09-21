import { Migration } from '@mikro-orm/migrations';

export class Migration20260915030736_resources extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "resources_resources" drop constraint if exists "resources_resources_code_scope_unique";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "resources_resources" add constraint "resources_resources_code_scope_unique" unique ("tenant_id", "organization_id", "code");`);
  }

}
