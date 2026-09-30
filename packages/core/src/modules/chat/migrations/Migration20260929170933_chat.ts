import { Migration } from '@mikro-orm/migrations';

/**
 * A contact's handle and CRM link. Spec: `.ai/specs/2026-09-29-whatsapp-bridge.md`
 * (Phase 4).
 *
 * `handle` is the number the network reveals, encrypted like the name — so the
 * tenants' existing encryption maps learn the field here, and a tenant created
 * later gets it from its seed. `customer_entity_id` names a `customers` record
 * by id only: no foreign key crosses the module boundary.
 */
export class Migration20260929170933_chat extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "chat_external_contacts" add "handle" text null, add "customer_entity_id" uuid null, add "customer_linked_by_user_id" uuid null, add "customer_linked_at" timestamptz null;`);
    this.addSql(`create index "chat_external_contacts_customer_idx" on "chat_external_contacts" ("tenant_id", "organization_id", "customer_entity_id") where "customer_entity_id" is not null;`);
    this.addSql(`alter table "chat_external_contacts" add constraint "chat_external_contacts_customer_chk" check (("customer_entity_id" is null) = ("customer_linked_at" is null));`);
    this.addSql(`do $$ begin
      if to_regclass('encryption_maps') is not null then
        update "encryption_maps"
        set "fields_json" = "fields_json" || '[{"field":"handle"}]'::jsonb, "updated_at" = now()
        where "entity_id" = 'chat:chat_external_contact'
          and "deleted_at" is null
          and not ("fields_json" @> '[{"field":"handle"}]'::jsonb);
      end if;
    end $$;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`do $$ begin
      if to_regclass('encryption_maps') is not null then
        update "encryption_maps"
        set "fields_json" = (
          select coalesce(jsonb_agg(field), '[]'::jsonb)
          from jsonb_array_elements("fields_json") field
          where field->>'field' <> 'handle'
        ), "updated_at" = now()
        where "entity_id" = 'chat:chat_external_contact'
          and "fields_json" @> '[{"field":"handle"}]'::jsonb;
      end if;
    end $$;`);
    this.addSql(`drop index if exists "chat_external_contacts_customer_idx";`);
    this.addSql(`alter table "chat_external_contacts" drop constraint if exists "chat_external_contacts_customer_chk";`);
    this.addSql(`alter table "chat_external_contacts" drop column "handle", drop column "customer_entity_id", drop column "customer_linked_by_user_id", drop column "customer_linked_at";`);
  }

}
