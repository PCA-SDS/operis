import { Migration } from '@mikro-orm/migrations'

export class Migration20260918120000_email_entitlement_acl extends Migration {
  override up(): void {
    this.addSql(`
      update "tenant_modules"
      set "is_enabled" = true, "updated_at" = now()
      where "module_id" = 'email' and "deleted_at" is null and not "is_enabled";
    `)

    this.addSql(`
      update "role_acls" as ra
      set "features_json" = (
        select jsonb_agg(distinct feature)
        from jsonb_array_elements_text(
          coalesce(ra."features_json", '[]'::jsonb) ||
          '["email.templates.view", "email.templates.manage", "email.accounting_defaults.view", "email.accounting_defaults.manage"]'::jsonb
        ) as feature
      ), "updated_at" = now()
      from "roles" as r
      where r."id" = ra."role_id"
        and r."name" in ('admin', 'superadmin')
        and ra."deleted_at" is null;
    `)
  }
}
