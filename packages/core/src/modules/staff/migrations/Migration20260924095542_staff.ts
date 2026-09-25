import { Migration } from '@mikro-orm/migrations';

export class Migration20260924095542_staff extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "staff_team_members" add "is_auto_provisioned" boolean not null default false;`);
    this.addSql(`insert into "directory_user_organization_memberships" ("tenant_id", "user_id", "organization_id", "is_active", "created_at", "updated_at") select "tenant_id", "user_id", "organization_id", true, now(), now() from "staff_team_members" where "user_id" is not null and "is_active" = true and "deleted_at" is null on conflict ("tenant_id", "user_id", "organization_id") do nothing;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "staff_team_members" drop column "is_auto_provisioned";`);
  }

}
