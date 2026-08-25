import { Migration } from '@mikro-orm/migrations';

export class Migration20260824222711_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index "role_acls_role_tenant_idx" on "role_acls" ("role_id", "tenant_id");`);

    this.addSql(`create index "user_acls_user_tenant_idx" on "user_acls" ("user_id", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "role_acls_role_tenant_idx";`);

    this.addSql(`drop index "user_acls_user_tenant_idx";`);
  }

}
