import { Migration } from '@mikro-orm/migrations';

export class Migration20260826093802_mcp extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "rule_execution_logs" drop constraint if exists "rule_execution_logs_rule_id_foreign";`);
    this.addSql(`alter table "rule_set_members" drop constraint if exists "rule_set_members_rule_id_foreign";`);
    this.addSql(`alter table "catalog_product_variant_prices" drop constraint if exists "catalog_product_variant_prices_price_kind_id_foreign";`);
    this.addSql(`alter table "catalog_product_category_assignments" drop constraint if exists "catalog_product_category_assignments_category_id_foreign";`);
    this.addSql(`alter table "catalog_product_variant_prices" drop constraint if exists "catalog_product_variant_prices_offer_id_foreign";`);
    this.addSql(`alter table "catalog_products" drop constraint if exists "catalog_products_option_schema_id_foreign";`);
    this.addSql(`alter table "catalog_product_tag_assignments" drop constraint if exists "catalog_product_tag_assignments_tag_id_foreign";`);
    this.addSql(`alter table "catalog_product_variant_option_values" drop constraint if exists "catalog_product_variant_option_values_variant_id_foreign";`);
    this.addSql(`alter table "catalog_product_variant_prices" drop constraint if exists "catalog_product_variant_prices_variant_id_foreign";`);
    this.addSql(`alter table "catalog_product_variant_relations" drop constraint if exists "catalog_product_variant_relations_child_variant_id_foreign";`);
    this.addSql(`alter table "catalog_product_variant_relations" drop constraint if exists "catalog_product_variant_relations_parent_variant_id_foreign";`);
    this.addSql(`alter table "catalog_product_category_assignments" drop constraint if exists "catalog_product_category_assignments_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_offers" drop constraint if exists "catalog_product_offers_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_options" drop constraint if exists "catalog_product_options_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_relations" drop constraint if exists "catalog_product_relations_child_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_relations" drop constraint if exists "catalog_product_relations_parent_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_tag_assignments" drop constraint if exists "catalog_product_tag_assignments_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_unit_conversions" drop constraint if exists "catalog_product_unit_conversions_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_variant_prices" drop constraint if exists "catalog_product_variant_prices_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_variants" drop constraint if exists "catalog_product_variants_product_id_foreign";`);
    this.addSql(`alter table "customer_activities" drop constraint if exists "customer_activities_deal_id_foreign";`);
    this.addSql(`alter table "customer_comments" drop constraint if exists "customer_comments_deal_id_foreign";`);
    this.addSql(`alter table "customer_deal_companies" drop constraint if exists "customer_deal_companies_deal_id_foreign";`);
    this.addSql(`alter table "customer_deal_people" drop constraint if exists "customer_deal_people_deal_id_foreign";`);
    this.addSql(`alter table "customer_deal_stage_transitions" drop constraint if exists "customer_deal_stage_transitions_deal_id_foreign";`);
    this.addSql(`alter table "customer_activities" drop constraint if exists "customer_activities_entity_id_foreign";`);
    this.addSql(`alter table "customer_addresses" drop constraint if exists "customer_addresses_entity_id_foreign";`);
    this.addSql(`alter table "customer_comments" drop constraint if exists "customer_comments_entity_id_foreign";`);
    this.addSql(`alter table "customer_companies" drop constraint if exists "customer_companies_entity_id_foreign";`);
    this.addSql(`alter table "customer_company_billing" drop constraint if exists "customer_company_billing_entity_id_foreign";`);
    this.addSql(`alter table "customer_deal_companies" drop constraint if exists "customer_deal_companies_company_entity_id_foreign";`);
    this.addSql(`alter table "customer_deal_people" drop constraint if exists "customer_deal_people_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_interactions" drop constraint if exists "customer_interactions_entity_id_foreign";`);
    this.addSql(`alter table "customer_label_assignments" drop constraint if exists "customer_label_assignments_entity_id_foreign";`);
    this.addSql(`alter table "customer_people" drop constraint if exists "customer_people_company_entity_id_foreign";`);
    this.addSql(`alter table "customer_people" drop constraint if exists "customer_people_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_links" drop constraint if exists "customer_person_company_links_company_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_links" drop constraint if exists "customer_person_company_links_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_roles" drop constraint if exists "customer_person_company_roles_company_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_roles" drop constraint if exists "customer_person_company_roles_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_tag_assignments" drop constraint if exists "customer_tag_assignments_entity_id_foreign";`);
    this.addSql(`alter table "customer_todo_links" drop constraint if exists "customer_todo_links_entity_id_foreign";`);
    this.addSql(`alter table "customer_label_assignments" drop constraint if exists "customer_label_assignments_label_id_foreign";`);
    this.addSql(`alter table "customer_role_acls" drop constraint if exists "customer_role_acls_role_id_foreign";`);
    this.addSql(`alter table "customer_user_roles" drop constraint if exists "customer_user_roles_role_id_foreign";`);
    this.addSql(`alter table "customer_tag_assignments" drop constraint if exists "customer_tag_assignments_tag_id_foreign";`);
    this.addSql(`alter table "customer_user_acls" drop constraint if exists "customer_user_acls_user_id_foreign";`);
    this.addSql(`alter table "customer_user_email_verifications" drop constraint if exists "customer_user_email_verifications_user_id_foreign";`);
    this.addSql(`alter table "customer_user_password_resets" drop constraint if exists "customer_user_password_resets_user_id_foreign";`);
    this.addSql(`alter table "customer_user_roles" drop constraint if exists "customer_user_roles_user_id_foreign";`);
    this.addSql(`alter table "customer_user_sessions" drop constraint if exists "customer_user_sessions_user_id_foreign";`);
    this.addSql(`alter table "dictionary_entries" drop constraint if exists "dictionary_entries_dictionary_id_foreign";`);
    this.addSql(`alter table "domain_mappings" drop constraint if exists "domain_mappings_replaces_domain_id_foreign";`);
    this.addSql(`alter table "feature_toggle_audit_logs" drop constraint if exists "feature_toggle_audit_logs_toggle_id_foreign";`);
    this.addSql(`alter table "feature_toggle_overrides" drop constraint if exists "feature_toggle_overrides_toggle_id_foreign";`);
    this.addSql(`alter table "resources_resource_tag_assignments" drop constraint if exists "resources_resource_tag_assignments_tag_id_foreign";`);
    this.addSql(`alter table "resources_resource_activities" drop constraint if exists "resources_resource_activities_resource_id_foreign";`);
    this.addSql(`alter table "resources_resource_comments" drop constraint if exists "resources_resource_comments_resource_id_foreign";`);
    this.addSql(`alter table "resources_resource_tag_assignments" drop constraint if exists "resources_resource_tag_assignments_resource_id_foreign";`);
    this.addSql(`alter table "role_acls" drop constraint if exists "role_acls_role_id_foreign";`);
    this.addSql(`alter table "role_sidebar_preferences" drop constraint if exists "role_sidebar_preferences_role_id_foreign";`);
    this.addSql(`alter table "user_roles" drop constraint if exists "user_roles_role_id_foreign";`);
    this.addSql(`alter table "rule_set_members" drop constraint if exists "rule_set_members_rule_set_id_foreign";`);
    this.addSql(`alter table "sales_orders" drop constraint if exists "sales_orders_channel_ref_id_foreign";`);
    this.addSql(`alter table "sales_quotes" drop constraint if exists "sales_quotes_channel_ref_id_foreign";`);
    this.addSql(`alter table "sales_credit_memo_lines" drop constraint if exists "sales_credit_memo_lines_credit_memo_id_foreign";`);
    this.addSql(`alter table "sales_orders" drop constraint if exists "sales_orders_delivery_window_ref_id_foreign";`);
    this.addSql(`alter table "sales_quotes" drop constraint if exists "sales_quotes_delivery_window_ref_id_foreign";`);
    this.addSql(`alter table "sales_document_tag_assignments" drop constraint if exists "sales_document_tag_assignments_tag_id_foreign";`);
    this.addSql(`alter table "sales_credit_memos" drop constraint if exists "sales_credit_memos_invoice_id_foreign";`);
    this.addSql(`alter table "sales_invoice_lines" drop constraint if exists "sales_invoice_lines_invoice_id_foreign";`);
    this.addSql(`alter table "sales_payment_allocations" drop constraint if exists "sales_payment_allocations_invoice_id_foreign";`);
    this.addSql(`alter table "sales_credit_memo_lines" drop constraint if exists "sales_credit_memo_lines_order_line_id_foreign";`);
    this.addSql(`alter table "sales_invoice_lines" drop constraint if exists "sales_invoice_lines_order_line_id_foreign";`);
    this.addSql(`alter table "sales_order_adjustments" drop constraint if exists "sales_order_adjustments_order_line_id_foreign";`);
    this.addSql(`alter table "sales_return_lines" drop constraint if exists "sales_return_lines_order_line_id_foreign";`);
    this.addSql(`alter table "sales_shipment_items" drop constraint if exists "sales_shipment_items_order_line_id_foreign";`);
    this.addSql(`alter table "sales_credit_memos" drop constraint if exists "sales_credit_memos_order_id_foreign";`);
    this.addSql(`alter table "sales_document_addresses" drop constraint if exists "sales_document_addresses_order_id_foreign";`);
    this.addSql(`alter table "sales_document_tag_assignments" drop constraint if exists "sales_document_tag_assignments_order_id_foreign";`);
    this.addSql(`alter table "sales_invoices" drop constraint if exists "sales_invoices_order_id_foreign";`);
    this.addSql(`alter table "sales_notes" drop constraint if exists "sales_notes_order_id_foreign";`);
    this.addSql(`alter table "sales_order_adjustments" drop constraint if exists "sales_order_adjustments_order_id_foreign";`);
    this.addSql(`alter table "sales_order_lines" drop constraint if exists "sales_order_lines_order_id_foreign";`);
    this.addSql(`alter table "sales_payment_allocations" drop constraint if exists "sales_payment_allocations_order_id_foreign";`);
    this.addSql(`alter table "sales_payments" drop constraint if exists "sales_payments_order_id_foreign";`);
    this.addSql(`alter table "sales_returns" drop constraint if exists "sales_returns_order_id_foreign";`);
    this.addSql(`alter table "sales_shipments" drop constraint if exists "sales_shipments_order_id_foreign";`);
    this.addSql(`alter table "sales_orders" drop constraint if exists "sales_orders_payment_method_ref_id_foreign";`);
    this.addSql(`alter table "sales_payments" drop constraint if exists "sales_payments_payment_method_id_foreign";`);
    this.addSql(`alter table "sales_quotes" drop constraint if exists "sales_quotes_payment_method_ref_id_foreign";`);
    this.addSql(`alter table "sales_payment_allocations" drop constraint if exists "sales_payment_allocations_payment_id_foreign";`);
    this.addSql(`alter table "sales_quote_adjustments" drop constraint if exists "sales_quote_adjustments_quote_line_id_foreign";`);
    this.addSql(`alter table "sales_document_addresses" drop constraint if exists "sales_document_addresses_quote_id_foreign";`);
    this.addSql(`alter table "sales_document_tag_assignments" drop constraint if exists "sales_document_tag_assignments_quote_id_foreign";`);
    this.addSql(`alter table "sales_notes" drop constraint if exists "sales_notes_quote_id_foreign";`);
    this.addSql(`alter table "sales_quote_adjustments" drop constraint if exists "sales_quote_adjustments_quote_id_foreign";`);
    this.addSql(`alter table "sales_quote_lines" drop constraint if exists "sales_quote_lines_quote_id_foreign";`);
    this.addSql(`alter table "sales_return_lines" drop constraint if exists "sales_return_lines_return_id_foreign";`);
    this.addSql(`alter table "sales_shipment_items" drop constraint if exists "sales_shipment_items_shipment_id_foreign";`);
    this.addSql(`alter table "sales_orders" drop constraint if exists "sales_orders_shipping_method_ref_id_foreign";`);
    this.addSql(`alter table "sales_quotes" drop constraint if exists "sales_quotes_shipping_method_ref_id_foreign";`);
    this.addSql(`alter table "staff_leave_requests" drop constraint if exists "staff_leave_requests_member_id_foreign";`);
    this.addSql(`alter table "staff_team_member_activities" drop constraint if exists "staff_team_member_activities_member_id_foreign";`);
    this.addSql(`alter table "staff_team_member_addresses" drop constraint if exists "staff_team_member_addresses_member_id_foreign";`);
    this.addSql(`alter table "staff_team_member_comments" drop constraint if exists "staff_team_member_comments_member_id_foreign";`);
    this.addSql(`alter table "staff_team_member_job_histories" drop constraint if exists "staff_team_member_job_histories_member_id_foreign";`);
    this.addSql(`alter table "organizations" drop constraint if exists "organizations_tenant_id_foreign";`);
    this.addSql(`alter table "tenant_modules" drop constraint if exists "tenant_modules_tenant_id_foreign";`);
    this.addSql(`alter table "password_resets" drop constraint if exists "password_resets_user_id_foreign";`);
    this.addSql(`alter table "sessions" drop constraint if exists "sessions_user_id_foreign";`);
    this.addSql(`alter table "sidebar_variants" drop constraint if exists "sidebar_variants_user_id_foreign";`);
    this.addSql(`alter table "user_acls" drop constraint if exists "user_acls_user_id_foreign";`);
    this.addSql(`alter table "user_modules" drop constraint if exists "user_modules_user_id_foreign";`);
    this.addSql(`alter table "user_roles" drop constraint if exists "user_roles_user_id_foreign";`);
    this.addSql(`alter table "user_sidebar_preferences" drop constraint if exists "user_sidebar_preferences_user_id_foreign";`);
    this.addSql(`alter table "warranty_claim_events" drop constraint if exists "warranty_claim_events_claim_id_foreign";`);
    this.addSql(`alter table "warranty_claim_lines" drop constraint if exists "warranty_claim_lines_claim_id_foreign";`);
    this.addSql(`alter table "wms_inventory_balances" drop constraint if exists "wms_inventory_balances_lot_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_lot_id_foreign";`);
    this.addSql(`alter table "wms_inventory_reservations" drop constraint if exists "wms_inventory_reservations_lot_id_foreign";`);
    this.addSql(`alter table "wms_inventory_balances" drop constraint if exists "wms_inventory_balances_location_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_location_from_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_location_to_id_foreign";`);
    this.addSql(`alter table "wms_warehouse_locations" drop constraint if exists "wms_warehouse_locations_parent_id_foreign";`);
    this.addSql(`alter table "wms_inventory_balances" drop constraint if exists "wms_inventory_balances_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_inventory_reservations" drop constraint if exists "wms_inventory_reservations_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_warehouse_locations" drop constraint if exists "wms_warehouse_locations_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_warehouse_zones" drop constraint if exists "wms_warehouse_zones_warehouse_id_foreign";`);

    this.addSql(`drop index "mcp_oauth_authorization_codes_client_user_idx";`);
    this.addSql(`alter table "mcp_oauth_authorization_codes" drop constraint if exists "mcp_oauth_authorization_codes_code_hash_uq";`);
    this.addSql(`alter table "mcp_oauth_authorization_codes" add constraint "mcp_oauth_authorization_codes_code_hash_unique" unique ("code_hash");`);

    this.addSql(`drop index "mcp_oauth_clients_tenant_idx";`);
    this.addSql(`alter table "mcp_oauth_clients" drop constraint if exists "mcp_oauth_clients_registration_source_check";`);
    this.addSql(`alter table "mcp_oauth_clients" drop constraint if exists "mcp_oauth_clients_client_id_uq";`);
    this.addSql(`alter table "mcp_oauth_clients" add constraint "mcp_oauth_clients_client_id_unique" unique ("client_id");`);

    this.addSql(`drop index "mcp_oauth_refresh_tokens_client_user_idx";`);
    this.addSql(`alter table "mcp_oauth_refresh_tokens" drop constraint if exists "mcp_oauth_refresh_tokens_token_hash_uq";`);
    this.addSql(`alter table "mcp_oauth_refresh_tokens" add constraint "mcp_oauth_refresh_tokens_token_hash_unique" unique ("token_hash");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`create table "access_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "actor_user_id" uuid null, "resource_kind" text not null, "resource_id" text not null, "access_type" text not null, "fields_json" jsonb null, "context_json" jsonb null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "access_logs_actor_idx" on "access_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "access_logs_created_at_idx" on "access_logs" ("created_at");`);
    this.addSql(`create index "access_logs_tenant_idx" on "access_logs" ("tenant_id", "created_at");`);

    this.addSql(`create table "action_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "actor_user_id" uuid null, "command_id" text not null, "action_label" text null, "resource_kind" text null, "resource_id" text null, "execution_state" text not null default 'done', "undo_token" text null, "command_payload" jsonb null, "snapshot_before" jsonb null, "snapshot_after" jsonb null, "changes_json" jsonb null, "context_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "parent_resource_kind" text null, "parent_resource_id" text null, "action_type" text null, "changed_fields" text[] null, "primary_changed_field" text null, "source_key" text null, "related_resource_kind" text null, "related_resource_id" text null, primary key ("id"));`);
    this.addSql(`create index "action_logs_action_type_idx" on "action_logs" ("tenant_id", "organization_id", "action_type", "created_at");`);
    this.addSql(`create index "action_logs_actor_idx" on "action_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "action_logs_changed_fields_idx" on "action_logs" ("changed_fields");`);
    this.addSql(`create index "action_logs_parent_resource_idx" on "action_logs" ("tenant_id", "parent_resource_kind", "parent_resource_id", "created_at");`);
    this.addSql(`create index "action_logs_primary_changed_field_idx" on "action_logs" ("tenant_id", "organization_id", "primary_changed_field", "created_at");`);
    this.addSql(`create index "action_logs_related_resource_idx" on "action_logs" ("tenant_id", "related_resource_kind", "related_resource_id", "created_at");`);
    this.addSql(`create index "action_logs_resource_idx" on "action_logs" ("tenant_id", "resource_kind", "resource_id", "created_at");`);
    this.addSql(`create index "action_logs_source_key_idx" on "action_logs" ("tenant_id", "organization_id", "source_key", "created_at");`);
    this.addSql(`create index "action_logs_tenant_idx" on "action_logs" ("tenant_id", "created_at");`);

    this.addSql(`create table "ai_agent_mutation_policy_overrides" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" text not null, "mutation_policy" text not null, "notes" text null, "created_by_user_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "ai_agent_mutation_policy_overrides_tenant_agent_idx" on "ai_agent_mutation_policy_overrides" ("tenant_id", "agent_id");`);
    this.addSql(`create unique index "ai_agent_mutation_policy_overrides_tenant_agent_null_org_uq" on "ai_agent_mutation_policy_overrides" ("tenant_id", "agent_id") where organization_id IS NULL;`);
    this.addSql(`create unique index "ai_agent_mutation_policy_overrides_tenant_org_agent_uq" on "ai_agent_mutation_policy_overrides" ("tenant_id", "organization_id", "agent_id") where organization_id IS NOT NULL;`);

    this.addSql(`create table "ai_agent_prompt_overrides" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" text not null, "version" int4 not null, "sections" jsonb not null, "notes" text null, "created_by_user_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "ai_agent_prompt_overrides_tenant_agent_idx" on "ai_agent_prompt_overrides" ("tenant_id", "agent_id");`);
    this.addSql(`create unique index "ai_agent_prompt_overrides_tenant_agent_version_null_org_uq" on "ai_agent_prompt_overrides" ("tenant_id", "agent_id", "version") where organization_id IS NULL;`);
    this.addSql(`create index "ai_agent_prompt_overrides_tenant_org_agent_version_idx" on "ai_agent_prompt_overrides" ("tenant_id", "organization_id", "agent_id", "version" DESC);`);
    this.addSql(`create unique index "ai_agent_prompt_overrides_tenant_org_agent_version_uq" on "ai_agent_prompt_overrides" ("tenant_id", "organization_id", "agent_id", "version") where organization_id IS NOT NULL;`);

    this.addSql(`create table "ai_agent_runtime_overrides" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" varchar(128) null, "provider_id" varchar(64) null, "model_id" varchar(256) null, "base_url" varchar(2048) null, "updated_by_user_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "loop_disabled" bool null, "loop_max_steps" int4 null, "loop_max_tool_calls" int4 null, "loop_max_wall_clock_ms" int4 null, "loop_max_tokens" int4 null, "loop_stop_when_json" jsonb null, "loop_active_tools_json" jsonb null, "allowed_override_providers" jsonb null, "allowed_override_models_by_provider" jsonb not null default '{}', "input_moderation" bool null, primary key ("id"));`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_agent_null_org_uq" on "ai_agent_runtime_overrides" ("tenant_id", "agent_id") where (deleted_at IS NULL) AND (organization_id IS NULL) AND (agent_id IS NOT NULL);`);
    this.addSql(`create index "ai_agent_runtime_overrides_tenant_idx" on "ai_agent_runtime_overrides" ("tenant_id");`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_null_agent_null_org_uq" on "ai_agent_runtime_overrides" ("tenant_id") where (deleted_at IS NULL) AND (organization_id IS NULL) AND (agent_id IS NULL);`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_org_agent_uq" on "ai_agent_runtime_overrides" ("tenant_id", "organization_id", "agent_id") where (deleted_at IS NULL) AND (organization_id IS NOT NULL) AND (agent_id IS NOT NULL);`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_org_null_agent_uq" on "ai_agent_runtime_overrides" ("tenant_id", "organization_id") where (deleted_at IS NULL) AND (organization_id IS NOT NULL) AND (agent_id IS NULL);`);

    this.addSql(`create table "ai_chat_conversation_participants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "conversation_id" text not null, "user_id" uuid not null, "role" text not null default 'owner', "last_read_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "ai_chat_conv_participants_active_conv_user_idx" on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "conversation_id", "user_id") where deleted_at IS NULL;`);
    this.addSql(`create unique index "ai_chat_conv_participants_tenant_conv_user_null_org_uq" on "ai_chat_conversation_participants" ("tenant_id", "conversation_id", "user_id") where organization_id IS NULL;`);
    this.addSql(`create unique index "ai_chat_conv_participants_tenant_org_conv_user_uq" on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "conversation_id", "user_id") where organization_id IS NOT NULL;`);
    this.addSql(`create index "ai_chat_conv_participants_tenant_org_user_conv_idx" on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "user_id", "conversation_id");`);

    this.addSql(`create table "ai_chat_conversations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "conversation_id" text not null, "agent_id" text not null, "owner_user_id" uuid not null, "title" text null, "status" text not null default 'open', "visibility" text not null default 'private', "page_context" jsonb null, "last_message_at" timestamptz(6) null, "imported_from_local_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "ai_chat_conversations_tenant_conv_null_org_uq" on "ai_chat_conversations" ("tenant_id", "conversation_id") where (organization_id IS NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create unique index "ai_chat_conversations_tenant_org_conv_uq" on "ai_chat_conversations" ("tenant_id", "organization_id", "conversation_id") where (organization_id IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "ai_chat_conversations_tenant_org_deleted_idx" on "ai_chat_conversations" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create index "ai_chat_conversations_tenant_org_owner_agent_idx" on "ai_chat_conversations" ("tenant_id", "organization_id", "owner_user_id", "agent_id", "status", "last_message_at");`);

    this.addSql(`create table "ai_chat_messages" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "conversation_id" text not null, "client_message_id" text null, "role" text not null, "content" text not null, "ui_parts" jsonb null, "attachment_ids" jsonb null, "files_metadata" jsonb null, "model" text null, "metadata" jsonb null, "created_by_user_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "ai_chat_messages_tenant_conv_client_id_null_org_uq" on "ai_chat_messages" ("tenant_id", "conversation_id", "client_message_id") where (organization_id IS NULL) AND (client_message_id IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create unique index "ai_chat_messages_tenant_org_conv_client_id_uq" on "ai_chat_messages" ("tenant_id", "organization_id", "conversation_id", "client_message_id") where (organization_id IS NOT NULL) AND (client_message_id IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "ai_chat_messages_tenant_org_conv_created_idx" on "ai_chat_messages" ("tenant_id", "organization_id", "conversation_id", "created_at");`);
    this.addSql(`create index "ai_chat_messages_tenant_org_deleted_idx" on "ai_chat_messages" ("tenant_id", "organization_id", "deleted_at");`);

    this.addSql(`create table "ai_moderation_flags" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" text not null, "user_id" text not null, "provider_id" text not null, "model_id" text not null, "categories" jsonb not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "ai_moderation_flags_tenant_created_idx" on "ai_moderation_flags" ("tenant_id", "created_at");`);
    this.addSql(`create index "ai_moderation_flags_tenant_user_idx" on "ai_moderation_flags" ("tenant_id", "user_id");`);

    this.addSql(`create table "ai_pending_actions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" text not null, "tool_name" text not null, "conversation_id" text null, "target_entity_type" text null, "target_record_id" text null, "normalized_input" jsonb not null, "field_diff" jsonb not null default '[]', "records" jsonb null, "failed_records" jsonb null, "side_effects_summary" text null, "record_version" text null, "attachment_ids" jsonb not null default '[]', "idempotency_key" text not null, "created_by_user_id" uuid not null, "status" text not null, "queue_mode" text not null default 'inline', "execution_result" jsonb null, "created_at" timestamptz(6) not null, "expires_at" timestamptz(6) not null, "resolved_at" timestamptz(6) null, "resolved_by_user_id" uuid null, primary key ("id"));`);
    this.addSql(`create unique index "ai_pending_actions_tenant_idem_null_org_uq" on "ai_pending_actions" ("tenant_id", "idempotency_key") where organization_id IS NULL;`);
    this.addSql(`create index "ai_pending_actions_tenant_org_agent_status_idx" on "ai_pending_actions" ("tenant_id", "organization_id", "agent_id", "status");`);
    this.addSql(`create unique index "ai_pending_actions_tenant_org_idempotency_uq" on "ai_pending_actions" ("tenant_id", "organization_id", "idempotency_key") where organization_id IS NOT NULL;`);
    this.addSql(`create index "ai_pending_actions_tenant_org_status_expires_idx" on "ai_pending_actions" ("tenant_id", "organization_id", "status", "expires_at");`);

    this.addSql(`create table "ai_tenant_model_allowlists" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "allowed_providers" jsonb null, "allowed_models_by_provider" jsonb not null default '{}', "updated_by_user_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "ai_tenant_model_allowlists_tenant_idx" on "ai_tenant_model_allowlists" ("tenant_id");`);
    this.addSql(`create unique index "ai_tenant_model_allowlists_tenant_null_org_uq" on "ai_tenant_model_allowlists" ("tenant_id") where (deleted_at IS NULL) AND (organization_id IS NULL);`);
    this.addSql(`create unique index "ai_tenant_model_allowlists_tenant_org_uq" on "ai_tenant_model_allowlists" ("tenant_id", "organization_id") where (deleted_at IS NULL) AND (organization_id IS NOT NULL);`);

    this.addSql(`create table "ai_token_usage_daily" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "day" date not null, "agent_id" text not null, "model_id" text not null, "provider_id" text not null, "input_tokens" int8 not null default 0, "output_tokens" int8 not null default 0, "cached_input_tokens" int8 not null default 0, "reasoning_tokens" int8 not null default 0, "step_count" int8 not null default 0, "turn_count" int8 not null default 0, "session_count" int8 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create unique index "ai_token_usage_daily_tenant_day_agent_model_null_org_uq" on "ai_token_usage_daily" ("tenant_id", "day", "agent_id", "model_id") where organization_id IS NULL;`);
    this.addSql(`create unique index "ai_token_usage_daily_tenant_day_agent_model_org_uq" on "ai_token_usage_daily" ("tenant_id", "day", "agent_id", "model_id", "organization_id") where organization_id IS NOT NULL;`);
    this.addSql(`create index "ai_token_usage_daily_tenant_day_idx" on "ai_token_usage_daily" ("tenant_id", "day");`);

    this.addSql(`create table "ai_token_usage_events" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "user_id" uuid not null, "agent_id" text not null, "module_id" text not null, "session_id" uuid not null, "turn_id" uuid not null, "step_index" int4 not null, "provider_id" text not null, "model_id" text not null, "input_tokens" int4 not null, "output_tokens" int4 not null, "cached_input_tokens" int4 null, "reasoning_tokens" int4 null, "finish_reason" text null, "loop_abort_reason" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "ai_token_usage_events_tenant_agent_created_idx" on "ai_token_usage_events" ("tenant_id", "agent_id", "created_at" DESC);`);
    this.addSql(`create index "ai_token_usage_events_tenant_created_idx" on "ai_token_usage_events" ("tenant_id", "created_at" DESC);`);
    this.addSql(`create index "ai_token_usage_events_tenant_model_created_idx" on "ai_token_usage_events" ("tenant_id", "model_id", "created_at" DESC);`);
    this.addSql(`create index "ai_token_usage_events_tenant_session_turn_step_idx" on "ai_token_usage_events" ("tenant_id", "session_id", "turn_id", "step_index");`);

    this.addSql(`create table "api_keys" ("id" uuid not null default gen_random_uuid(), "name" text not null, "description" text null, "tenant_id" uuid null, "organization_id" uuid null, "key_hash" text not null, "key_prefix" text not null, "roles_json" jsonb null, "created_by" uuid null, "last_used_at" timestamptz(6) null, "expires_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, "session_token" text null, "session_user_id" uuid null, "session_secret_encrypted" text null, "opencode_session_id" text null, primary key ("id"));`);
    this.addSql(`alter table "api_keys" add constraint "api_keys_key_prefix_unique" unique ("key_prefix");`);
    this.addSql(`create unique index "api_keys_opencode_session_id_uq" on "api_keys" ("opencode_session_id") where (opencode_session_id IS NOT NULL) AND (deleted_at IS NULL);`);

    this.addSql(`create table "attachment_partitions" ("id" uuid not null default gen_random_uuid(), "code" text not null, "title" text not null, "description" text null, "storage_driver" text not null default 'local', "config_json" jsonb null, "is_public" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "requires_ocr" bool not null default true, "ocr_model" text null, "organization_id" uuid null, "tenant_id" uuid null, primary key ("id"));`);
    this.addSql(`alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");`);
    this.addSql(`create index "attachment_partitions_tenant_idx" on "attachment_partitions" ("tenant_id");`);

    this.addSql(`create table "attachment_quota_reservations" ("id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "reserved_bytes" int8 not null, "actual_bytes" int8 null, "status" text not null default 'reserved', "source" text not null, "storage_driver" text not null, "partition_code" text null, "storage_path" text not null, "lease_token" uuid not null, "upload_token_hash" text null, "expires_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "attachment_quota_reservations_expires_idx" on "attachment_quota_reservations" ("expires_at");`);
    this.addSql(`alter table "attachment_quota_reservations" add constraint "attachment_quota_reservations_scope_path_unique" unique ("tenant_id", "storage_driver", "storage_path");`);
    this.addSql(`create index "attachment_quota_reservations_tenant_status_idx" on "attachment_quota_reservations" ("tenant_id", "status");`);

    this.addSql(`create table "attachments" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "file_name" text not null, "mime_type" text not null, "file_size" int4 not null, "url" text not null, "created_at" timestamptz(6) not null, "partition_code" text not null, "storage_driver" text not null default 'local', "storage_path" text not null, "storage_metadata" jsonb null, "content" text null, primary key ("id"));`);
    this.addSql(`create index "attachments_entity_record_idx" on "attachments" ("record_id");`);
    this.addSql(`create index "attachments_partition_code_idx" on "attachments" ("partition_code");`);

    this.addSql(`create table "business_rules" ("id" uuid not null default gen_random_uuid(), "rule_id" varchar(50) not null, "rule_name" varchar(200) not null, "description" text null, "rule_type" varchar(20) not null, "rule_category" varchar(50) null, "entity_type" varchar(50) not null, "event_type" varchar(50) null, "condition_expression" jsonb null, "success_actions" jsonb null, "failure_actions" jsonb null, "enabled" bool not null default true, "priority" int4 not null default 100, "version" int4 not null default 1, "effective_from" timestamptz(6) null, "effective_to" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(50) null, "updated_by" varchar(50) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "business_rules_entity_event_idx" on "business_rules" ("entity_type", "event_type", "enabled");`);
    this.addSql(`alter table "business_rules" add constraint "business_rules_rule_id_tenant_id_unique" unique ("rule_id", "tenant_id");`);
    this.addSql(`create index "business_rules_tenant_org_idx" on "business_rules" ("tenant_id", "organization_id");`);
    this.addSql(`create index "business_rules_type_enabled_idx" on "business_rules" ("rule_type", "enabled", "priority");`);

    this.addSql(`create table "carrier_shipment_idempotency_keys" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "idempotency_key" text not null, "request_hash" text not null, "shipment_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "carrier_shipment_idempotency_keys" add constraint "carrier_shipment_idempotency_keys_unique" unique ("idempotency_key", "provider_key", "organization_id", "tenant_id");`);

    this.addSql(`create table "carrier_shipments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "provider_key" text not null, "carrier_shipment_id" text not null, "tracking_number" text not null, "unified_status" text not null default 'label_created', "carrier_status" text null, "label_url" text null, "label_data" text null, "tracking_events" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "last_webhook_at" timestamptz(6) null, "last_polled_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "carrier_shipments_order_id_organization_id_tenant_id_index" on "carrier_shipments" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "carrier_shipments_organization_id_tenant_id_unif_b5ab4_index" on "carrier_shipments" ("organization_id", "tenant_id", "unified_status");`);
    this.addSql(`create index "carrier_shipments_provider_key_carrier_shipment_i_f9f17_index" on "carrier_shipments" ("provider_key", "carrier_shipment_id", "organization_id");`);

    this.addSql(`create table "carrier_webhook_events" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "idempotency_key" text not null, "event_type" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "processed_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "carrier_webhook_events" add constraint "carrier_webhook_events_idempotency_unique" unique ("idempotency_key", "provider_key", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_price_kinds" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid not null, "code" text not null, "title" text not null, "display_mode" text not null default 'excluding-tax', "currency_code" text null, "is_promotion" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "catalog_price_kinds" add constraint "catalog_price_kinds_code_tenant_unique" unique ("tenant_id", "code");`);
    this.addSql(`create index "catalog_price_kinds_tenant_idx" on "catalog_price_kinds" ("tenant_id");`);

    this.addSql(`create table "catalog_product_categories" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "slug" text null, "description" text null, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int4 not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "metadata" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_categories_scope_idx" on "catalog_product_categories" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_categories" add constraint "catalog_product_categories_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "catalog_product_category_assignments" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "category_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_category_assignments_scope_idx" on "catalog_product_category_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_unique" unique ("product_id", "category_id");`);

    this.addSql(`create table "catalog_product_offers" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "channel_id" uuid not null, "title" text not null, "description" text null, "metadata" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "default_media_id" uuid null, "default_media_url" text null, primary key ("id"));`);
    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_channel_unique" unique ("product_id", "organization_id", "tenant_id", "channel_id");`);
    this.addSql(`create index "catalog_product_offers_scope_idx" on "catalog_product_offers" ("organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_option_schemas" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "schema" jsonb not null, "metadata" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "catalog_product_option_schemas" add constraint "catalog_product_option_schemas_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "catalog_product_option_schemas_scope_idx" on "catalog_product_option_schemas" ("organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_option_values" ("id" uuid not null default gen_random_uuid(), "option_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int4 not null default 0, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "catalog_product_option_values" add constraint "catalog_product_option_values_code_unique" unique ("organization_id", "tenant_id", "option_id", "code");`);
    this.addSql(`create index "catalog_product_option_values_scope_idx" on "catalog_product_option_values" ("option_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_options" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int4 not null default 0, "is_required" bool not null default false, "is_multiple" bool not null default false, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "input_type" text not null default 'select', "input_config" jsonb null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_options_scope_idx" on "catalog_product_options" ("product_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_relations" ("id" uuid not null default gen_random_uuid(), "parent_product_id" uuid not null, "child_product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "relation_type" text not null default 'grouped', "is_required" bool not null default false, "min_quantity" int4 null, "max_quantity" int4 null, "position" int4 not null default 0, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_relations_child_idx" on "catalog_product_relations" ("child_product_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_relations_parent_idx" on "catalog_product_relations" ("parent_product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_unique" unique ("parent_product_id", "child_product_id", "relation_type");`);

    this.addSql(`create table "catalog_product_tag_assignments" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "tag_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_tag_assignments_scope_idx" on "catalog_product_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_unique" unique ("product_id", "tag_id");`);

    this.addSql(`create table "catalog_product_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "label" text not null, "slug" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_tags_scope_idx" on "catalog_product_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tags" add constraint "catalog_product_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "catalog_product_unit_conversions" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "unit_code" text not null, "to_base_factor" numeric(24,12) not null, "sort_order" int4 not null default 0, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_unit_conversions_scope_idx" on "catalog_product_unit_conversions" ("organization_id", "tenant_id", "product_id");`);
    this.addSql(`alter table "catalog_product_unit_conversions" add constraint "catalog_product_unit_conversions_unique" unique ("product_id", "unit_code");`);

    this.addSql(`create table "catalog_product_variant_option_values" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid not null, "option_value_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "catalog_product_variant_option_values" add constraint "catalog_product_variant_option_values_unique" unique ("variant_id", "option_value_id");`);

    this.addSql(`create table "catalog_product_variant_prices" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "currency_code" text not null, "kind" text not null default 'regular', "min_quantity" int4 not null default 1, "max_quantity" int4 null, "unit_price_net" numeric(16,4) null, "unit_price_gross" numeric(16,4) null, "tax_rate" numeric(7,4) null, "metadata" jsonb null, "starts_at" timestamptz(6) null, "ends_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "product_id" uuid null, "offer_id" uuid null, "channel_id" uuid null, "user_id" uuid null, "user_group_id" uuid null, "customer_id" uuid null, "customer_group_id" uuid null, "price_kind_id" uuid not null, "tax_amount" numeric(16,4) null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_variant_prices_product_scope_idx" on "catalog_product_variant_prices" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_unique" unique ("variant_id", "organization_id", "tenant_id", "currency_code", "price_kind_id", "min_quantity");`);
    this.addSql(`create index "catalog_product_variant_prices_variant_scope_idx" on "catalog_product_variant_prices" ("variant_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_variant_relations" ("id" uuid not null default gen_random_uuid(), "parent_variant_id" uuid not null, "child_variant_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "relation_type" text not null default 'grouped', "is_required" bool not null default false, "min_quantity" int4 null, "max_quantity" int4 null, "position" int4 not null default 0, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_variant_relations_child_idx" on "catalog_product_variant_relations" ("child_variant_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_variant_relations_parent_idx" on "catalog_product_variant_relations" ("parent_variant_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_unique" unique ("parent_variant_id", "child_variant_id", "relation_type");`);

    this.addSql(`create table "catalog_product_variants" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "name" text null, "sku" text null, "barcode" text null, "status_entry_id" text null, "is_default" bool not null default false, "is_active" bool not null default true, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "custom_fieldset_code" text null, "default_media_id" uuid null, "default_media_url" text null, "tax_rate_id" uuid null, "tax_rate" numeric(7,4) null, "option_values" jsonb null, "gtin_type" text null, "hs_code" text null, primary key ("id"));`);
    this.addSql(`create unique index "catalog_product_variants_gtin_scope_unique" on "catalog_product_variants" ("tenant_id", "organization_id", "gtin_type", "barcode") where (deleted_at IS NULL) AND (gtin_type IS NOT NULL) AND (barcode IS NOT NULL);`);
    this.addSql(`create index "catalog_product_variants_scope_idx" on "catalog_product_variants" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_sku_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "catalog_products" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "description" text null, "subtitle" text null, "status_entry_id" uuid null, "primary_currency_code" text null, "default_unit" text null, "metadata" jsonb null, "is_configurable" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "product_type" text not null default 'simple', "sku" text null, "handle" text null, "option_schema_id" uuid null, "custom_fieldset_code" text null, "default_media_id" uuid null, "default_media_url" text null, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "tax_rate_id" uuid null, "tax_rate" numeric(7,4) null, "default_sales_unit" text null, "default_sales_unit_quantity" numeric(18,6) not null default '1', "uom_rounding_scale" int2 not null default 4, "uom_rounding_mode" text not null default 'half_up', "unit_price_enabled" bool not null default false, "unit_price_reference_unit" text null, "unit_price_base_quantity" numeric(18,6) null, "country_of_origin_code" text null, "pkwiu_code" text null, "cn_code" text null, "hs_code" text null, "tax_classification_code" text null, "gtu_codes" text[] null, "age_min" int2 null, "is_excise_good" bool not null default false, "excise_category" text null, "requires_prescription" bool not null default false, "hazmat_class" text null, "un_number" text null, "hazmat_packing_group" text null, "contains_lithium_battery" bool not null default false, "launch_at" timestamptz(6) null, "end_of_life_at" timestamptz(6) null, "available_from" timestamptz(6) null, "available_until" timestamptz(6) null, "min_order_qty" int4 null, "max_order_qty" int4 null, "order_qty_increment" int4 null, "requires_shipping" bool not null default true, "is_quote_only" bool not null default false, "seo_title" text null, "seo_description" text null, "canonical_url" text null, primary key ("id"));`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_handle_scope_unique" unique ("organization_id", "tenant_id", "handle");`);
    this.addSql(`create index "catalog_products_org_tenant_idx" on "catalog_products" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_sku_scope_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "channel_ingest_dead_letters" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "channel_id" uuid not null, "provider_key" text not null, "external_uid" text null, "external_message_id" text null, "error_class" text not null, "error_message" text not null, "raw_body" text null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "channel_ingest_dead_letters_channel_idx" on "channel_ingest_dead_letters" ("channel_id", "tenant_id");`);
    this.addSql(`create index "channel_ingest_dead_letters_created_idx" on "channel_ingest_dead_letters" ("tenant_id", "created_at");`);

    this.addSql(`create table "channel_thread_mappings" ("id" uuid not null default gen_random_uuid(), "external_conversation_id" uuid not null, "message_thread_id" uuid not null, "channel_id" uuid not null, "provider_key" text not null, "external_thread_ref" text not null, "assigned_user_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "channel_thread_mappings_ext_conv_idx" on "channel_thread_mappings" ("external_conversation_id", "tenant_id");`);
    this.addSql(`alter table "channel_thread_mappings" add constraint "channel_thread_mappings_ext_conv_uq" unique ("external_conversation_id", "tenant_id");`);
    this.addSql(`create index "channel_thread_mappings_thread_idx" on "channel_thread_mappings" ("message_thread_id", "tenant_id");`);

    this.addSql(`create table "channel_thread_tokens" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "message_thread_id" uuid not null, "token" text not null, "created_at" timestamptz(6) not null, "last_seen_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "channel_thread_tokens" add constraint "channel_thread_tokens_thread_uq" unique ("tenant_id", "message_thread_id");`);
    this.addSql(`alter table "channel_thread_tokens" add constraint "channel_thread_tokens_token_uq" unique ("tenant_id", "token");`);

    this.addSql(`create table "checkout_link_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "title" text null, "subtitle" text null, "description" text null, "logo_attachment_id" uuid null, "logo_url" text null, "primary_color" text null, "secondary_color" text null, "background_color" text null, "theme_mode" text not null default 'auto', "pricing_mode" text not null, "fixed_price_amount" numeric(12,2) null, "fixed_price_currency_code" text null, "fixed_price_includes_tax" bool not null default true, "fixed_price_original_amount" numeric(12,2) null, "custom_amount_min" numeric(12,2) null, "custom_amount_max" numeric(12,2) null, "custom_amount_currency_code" text null, "price_list_items" jsonb null, "gateway_provider_key" text null, "gateway_settings" jsonb null, "customer_fields_schema" jsonb null, "legal_documents" jsonb null, "display_custom_fields_on_page" bool not null default false, "success_title" text null, "success_message" text null, "cancel_title" text null, "cancel_message" text null, "error_title" text null, "error_message" text null, "success_email_subject" text null, "success_email_body" text null, "error_email_subject" text null, "error_email_body" text null, "start_email_subject" text null, "start_email_body" text null, "password_hash" text null, "max_completions" int4 null, "status" text not null default 'draft', "checkout_type" text not null default 'pay_link', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "send_success_email" bool not null default true, "send_error_email" bool not null default true, "send_start_email" bool not null default true, "collect_customer_details" bool not null default true, "custom_fieldset_code" text null, primary key ("id"));`);
    this.addSql(`create index "checkout_link_templates_organization_id_tenant_id__9eeb6_index" on "checkout_link_templates" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "checkout_links" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "title" text null, "subtitle" text null, "description" text null, "logo_attachment_id" uuid null, "logo_url" text null, "primary_color" text null, "secondary_color" text null, "background_color" text null, "theme_mode" text not null default 'auto', "pricing_mode" text not null, "fixed_price_amount" numeric(12,2) null, "fixed_price_currency_code" text null, "fixed_price_includes_tax" bool not null default true, "fixed_price_original_amount" numeric(12,2) null, "custom_amount_min" numeric(12,2) null, "custom_amount_max" numeric(12,2) null, "custom_amount_currency_code" text null, "price_list_items" jsonb null, "gateway_provider_key" text null, "gateway_settings" jsonb null, "customer_fields_schema" jsonb null, "legal_documents" jsonb null, "display_custom_fields_on_page" bool not null default false, "success_title" text null, "success_message" text null, "cancel_title" text null, "cancel_message" text null, "error_title" text null, "error_message" text null, "success_email_subject" text null, "success_email_body" text null, "error_email_subject" text null, "error_email_body" text null, "start_email_subject" text null, "start_email_body" text null, "password_hash" text null, "max_completions" int4 null, "status" text not null default 'draft', "checkout_type" text not null default 'pay_link', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "template_id" uuid null, "slug" text not null, "completion_count" int4 not null default 0, "active_reservation_count" int4 not null default 0, "is_locked" bool not null default false, "send_success_email" bool not null default true, "send_error_email" bool not null default true, "send_start_email" bool not null default true, "collect_customer_details" bool not null default true, "custom_fieldset_code" text null, primary key ("id"));`);
    this.addSql(`create index "checkout_links_organization_id_tenant_id_deleted_at_index" on "checkout_links" ("organization_id", "tenant_id", "deleted_at");`);
    this.addSql(`create index "checkout_links_organization_id_tenant_id_status_de_49f3b_index" on "checkout_links" ("organization_id", "tenant_id", "status", "deleted_at");`);
    this.addSql(`create unique index "checkout_links_slug_index" on "checkout_links" ("slug") where deleted_at IS NULL;`);

    this.addSql(`create table "checkout_transactions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "link_id" uuid not null, "status" text not null, "amount" numeric(12,2) not null, "currency_code" text not null, "idempotency_key" text not null, "customer_data" jsonb null, "first_name" text null, "last_name" text null, "email" text null, "phone" text null, "gateway_transaction_id" uuid null, "payment_status" text null, "selected_price_item_id" text null, "accepted_legal_consents" jsonb null, "ip_address" text null, "user_agent" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "checkout_transactions_gateway_transaction_id_index" on "checkout_transactions" ("gateway_transaction_id");`);
    this.addSql(`create index "checkout_transactions_organization_id_tenant_id_cr_d105e_index" on "checkout_transactions" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`create unique index "checkout_transactions_organization_id_tenant_id_li_7548d_index" on "checkout_transactions" ("organization_id", "tenant_id", "link_id", "idempotency_key");`);
    this.addSql(`create index "checkout_transactions_organization_id_tenant_id_li_e6e13_index" on "checkout_transactions" ("organization_id", "tenant_id", "link_id", "status");`);

    this.addSql(`create table "communication_channels" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "channel_type" text not null, "display_name" text not null, "external_identifier" text null, "credentials_ref" uuid null, "capabilities" jsonb null, "is_active" bool not null default true, "user_id" uuid null, "is_primary" bool not null default false, "poll_interval_seconds" int4 null, "last_polled_at" timestamptz(6) null, "status" text not null default 'connected', "last_error" text null, "channel_state" jsonb null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "communication_channels_one_primary_per_user_uq" on "communication_channels" ("user_id") where is_primary AND (user_id IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "communication_channels_poll_due_idx" on "communication_channels" ("is_active", "last_polled_at") where deleted_at IS NULL;`);
    this.addSql(`create index "communication_channels_provider_external_idx" on "communication_channels" ("provider_key", "external_identifier") where deleted_at IS NULL;`);
    this.addSql(`create index "communication_channels_tenant_provider_idx" on "communication_channels" ("tenant_id", "provider_key");`);
    this.addSql(`create unique index "communication_channels_tenant_push_provider_uq" on "communication_channels" ("tenant_id", "provider_key") where (channel_type = 'push'::text) AND (user_id IS NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "communication_channels_tenant_type_active_idx" on "communication_channels" ("tenant_id", "channel_type", "is_active");`);
    this.addSql(`create index "communication_channels_user_lookup_idx" on "communication_channels" ("user_id", "channel_type", "deleted_at");`);
    this.addSql(`create unique index "communication_channels_user_provider_external_uq" on "communication_channels" ("tenant_id", "user_id", "provider_key", "external_identifier") where (deleted_at IS NULL) AND (user_id IS NOT NULL) AND (external_identifier IS NOT NULL);`);

    this.addSql(`create table "currencies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "symbol" text null, "decimal_places" int4 not null default 2, "thousands_separator" text null, "decimal_separator" text null, "is_base" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "currencies" add constraint "currencies_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "currencies_scope_idx" on "currencies" ("organization_id", "tenant_id");`);

    this.addSql(`create table "currency_fetch_configs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "provider" text not null, "is_enabled" bool not null default false, "sync_time" text null, "last_sync_at" timestamptz(6) null, "last_sync_status" text null, "last_sync_message" text null, "last_sync_count" int4 null, "config" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "currency_fetch_configs_enabled_idx" on "currency_fetch_configs" ("is_enabled", "sync_time");`);
    this.addSql(`alter table "currency_fetch_configs" add constraint "currency_fetch_configs_provider_scope_unique" unique ("organization_id", "tenant_id", "provider");`);
    this.addSql(`create index "currency_fetch_configs_scope_idx" on "currency_fetch_configs" ("organization_id", "tenant_id");`);

    this.addSql(`create table "custom_entities" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "label" text not null, "description" text null, "label_field" text null, "default_editor" text null, "show_in_sidebar" bool not null default false, "organization_id" uuid null, "tenant_id" uuid null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "access_restricted" bool not null default false, primary key ("id"));`);
    this.addSql(`create index "custom_entities_unique_idx" on "custom_entities" ("entity_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "custom_entities_storage" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "doc" jsonb not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "custom_entities_storage_unique_idx" on "custom_entities_storage" ("entity_type", "entity_id", "organization_id");`);

    this.addSql(`create table "custom_field_defs" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "key" text not null, "kind" text not null, "config_json" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "cf_defs_active_entity_global_idx" on "custom_field_defs" ("entity_id");`);
    this.addSql(`create index "cf_defs_active_entity_key_scope_idx" on "custom_field_defs" ("entity_id", "key", "tenant_id", "organization_id");`);
    this.addSql(`create index "cf_defs_active_entity_org_idx" on "custom_field_defs" ("entity_id", "organization_id");`);
    this.addSql(`create index "cf_defs_active_entity_tenant_idx" on "custom_field_defs" ("entity_id", "tenant_id");`);
    this.addSql(`create index "cf_defs_active_entity_tenant_org_idx" on "custom_field_defs" ("entity_id", "tenant_id", "organization_id");`);
    this.addSql(`create index "cf_defs_entity_key_idx" on "custom_field_defs" ("key");`);

    this.addSql(`create table "custom_field_entity_configs" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "config_json" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "cf_entity_cfgs_entity_org_idx" on "custom_field_entity_configs" ("entity_id", "organization_id");`);
    this.addSql(`create index "cf_entity_cfgs_entity_scope_idx" on "custom_field_entity_configs" ("entity_id", "tenant_id", "organization_id");`);
    this.addSql(`create index "cf_entity_cfgs_entity_tenant_idx" on "custom_field_entity_configs" ("entity_id", "tenant_id");`);

    this.addSql(`create table "custom_field_values" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "field_key" text not null, "value_text" text null, "value_multiline" text null, "value_int" int4 null, "value_float" float4 null, "value_bool" bool null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "cf_values_entity_record_field_idx" on "custom_field_values" ("field_key");`);
    this.addSql(`create index "cf_values_entity_record_tenant_idx" on "custom_field_values" ("entity_id", "record_id", "tenant_id");`);

    this.addSql(`create table "customer_activities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz(6) null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, "deal_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "customer_activities_entity_idx" on "customer_activities" ("entity_id");`);
    this.addSql(`create index "customer_activities_entity_occurred_created_idx" on "customer_activities" ("entity_id", "occurred_at", "created_at");`);
    this.addSql(`create index "customer_activities_org_tenant_idx" on "customer_activities" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_addresses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text null, "purpose" text null, "address_line1" text not null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "building_number" text null, "flat_number" text null, "latitude" float4 null, "longitude" float4 null, "is_primary" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, "company_name" text null, primary key ("id"));`);
    this.addSql(`create index "customer_addresses_entity_idx" on "customer_addresses" ("entity_id");`);

    this.addSql(`create table "customer_comments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "entity_id" uuid not null, "deal_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "customer_comments_entity_created_idx" on "customer_comments" ("entity_id", "created_at");`);
    this.addSql(`create index "customer_comments_entity_idx" on "customer_comments" ("entity_id");`);

    this.addSql(`create table "customer_companies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "legal_name" text null, "brand_name" text null, "domain" text null, "website_url" text null, "industry" text null, "size_bucket" text null, "annual_revenue" numeric(16,2) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, primary key ("id"));`);
    this.addSql(`alter table "customer_companies" add constraint "customer_companies_entity_id_unique" unique ("entity_id");`);
    this.addSql(`create index "customer_companies_org_tenant_idx" on "customer_companies" ("organization_id", "tenant_id");`);
    this.addSql(`create index "idx_customer_companies_entity_id" on "customer_companies" ("entity_id");`);

    this.addSql(`create table "customer_company_billing" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "entity_id" uuid not null, "bank_name" text null, "bank_account_masked" text null, "payment_terms" text null, "preferred_currency" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "customer_company_billing" add constraint "customer_company_billing_entity_unique" unique ("entity_id");`);
    this.addSql(`create index "customer_company_billing_scope_idx" on "customer_company_billing" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_deal_companies" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(6) not null, "deal_id" uuid not null, "company_entity_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "customer_deal_companies_company_idx" on "customer_deal_companies" ("company_entity_id");`);
    this.addSql(`create index "customer_deal_companies_deal_idx" on "customer_deal_companies" ("deal_id");`);
    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_unique" unique ("deal_id", "company_entity_id");`);

    this.addSql(`create table "customer_deal_people" ("id" uuid not null default gen_random_uuid(), "role" text null, "created_at" timestamptz(6) not null, "deal_id" uuid not null, "person_entity_id" uuid not null, "is_primary" bool not null default false, primary key ("id"));`);
    this.addSql(`create index "customer_deal_people_deal_idx" on "customer_deal_people" ("deal_id");`);
    this.addSql(`create index "customer_deal_people_person_idx" on "customer_deal_people" ("person_entity_id");`);
    this.addSql(`create unique index "customer_deal_people_primary_uq" on "customer_deal_people" ("deal_id") where is_primary;`);
    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_unique" unique ("deal_id", "person_entity_id");`);

    this.addSql(`create table "customer_deal_stage_transitions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid not null, "stage_id" uuid not null, "stage_label" text not null, "stage_order" int4 not null, "transitioned_at" timestamptz(6) not null, "transitioned_by_user_id" uuid null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "deal_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "customer_deal_stage_transitions_deal_idx" on "customer_deal_stage_transitions" ("deal_id");`);
    this.addSql(`alter table "customer_deal_stage_transitions" add constraint "customer_deal_stage_transitions_deal_stage_uq" unique ("deal_id", "stage_id");`);
    this.addSql(`create index "customer_deal_stage_transitions_org_tenant_idx" on "customer_deal_stage_transitions" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_deals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "description" text null, "status" text not null default 'open', "pipeline_stage" text null, "value_amount" numeric(14,2) null, "value_currency" text null, "probability" int4 null, "expected_close_at" timestamptz(6) null, "owner_user_id" uuid null, "source" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "pipeline_id" uuid null, "pipeline_stage_id" uuid null, "closure_outcome" text null, "loss_reason_id" uuid null, "loss_notes" text null, primary key ("id"));`);
    this.addSql(`create index "customer_deals_closure_stats_idx" on "customer_deals" ("organization_id", "tenant_id", "closure_outcome", "updated_at");`);
    this.addSql(`create index "customer_deals_org_tenant_idx" on "customer_deals" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_dictionary_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "value" text not null, "normalized_value" text not null, "label" text not null, "color" text null, "icon" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_dictionary_entries_scope_idx" on "customer_dictionary_entries" ("organization_id", "tenant_id", "kind");`);
    this.addSql(`alter table "customer_dictionary_entries" add constraint "customer_dictionary_entries_unique" unique ("organization_id", "tenant_id", "kind", "normalized_value");`);

    this.addSql(`create table "customer_dictionary_kind_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "selection_mode" text not null default 'single', "visible_in_tags" bool not null default true, "sort_order" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_dict_kind_settings_scope_idx" on "customer_dictionary_kind_settings" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "customer_dictionary_kind_settings" add constraint "customer_dict_kind_settings_unique" unique ("organization_id", "tenant_id", "kind");`);

    this.addSql(`create table "customer_entities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "display_name" text not null, "description" text null, "owner_user_id" uuid null, "primary_email" text null, "primary_phone" text null, "status" text null, "lifecycle_stage" text null, "source" text null, "next_interaction_at" timestamptz(6) null, "next_interaction_name" text null, "next_interaction_ref_id" text null, "next_interaction_icon" text null, "next_interaction_color" text null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "temperature" text null, "renewal_quarter" text null, primary key ("id"));`);
    this.addSql(`create index "customer_entities_org_tenant_kind_idx" on "customer_entities" ("organization_id", "tenant_id", "kind");`);
    this.addSql(`create index "idx_ce_tenant_company_id" on "customer_entities" ("tenant_id", "id");`);
    this.addSql(`create index "idx_ce_tenant_org_company_id" on "customer_entities" ("tenant_id", "organization_id", "id");`);
    this.addSql(`create index "idx_ce_tenant_org_person_id" on "customer_entities" ("tenant_id", "organization_id", "id");`);
    this.addSql(`create index "idx_ce_tenant_person_id" on "customer_entities" ("tenant_id", "id");`);

    this.addSql(`create table "customer_entity_roles" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" uuid not null, "user_id" uuid not null, "role_type" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "customer_entity_roles_active_unique" on "customer_entity_roles" ("entity_type", "entity_id", "role_type") where deleted_at IS NULL;`);
    this.addSql(`create index "customer_entity_roles_entity_idx" on "customer_entity_roles" ("entity_type", "entity_id");`);
    this.addSql(`create index "customer_entity_roles_scope_idx" on "customer_entity_roles" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_interactions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "interaction_type" text not null, "title" text null, "body" text null, "status" text not null default 'planned', "scheduled_at" timestamptz(6) null, "occurred_at" timestamptz(6) null, "priority" int4 null, "author_user_id" uuid null, "owner_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "source" text null, "deal_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "entity_id" uuid not null, "pinned" bool not null default false, "duration_minutes" int4 null, "location" text null, "all_day" bool null, "recurrence_rule" text null, "recurrence_end" timestamptz(6) null, "participants" jsonb null, "reminder_minutes" int4 null, "visibility" text null, "linked_entities" jsonb null, "guest_permissions" jsonb null, "external_message_id" uuid null, "channel_provider_key" text null, primary key ("id"));`);
    this.addSql(`create unique index "customer_interactions_email_dedupe_uq" on "customer_interactions" ("entity_id", "external_message_id") where (external_message_id IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "customer_interactions_email_visibility_idx" on "customer_interactions" ("entity_id", "interaction_type", "visibility", "author_user_id") where (interaction_type = 'email'::text) AND (deleted_at IS NULL);`);
    this.addSql(`create index "customer_interactions_entity_status_scheduled_idx" on "customer_interactions" ("entity_id", "status", "scheduled_at", "created_at");`);
    this.addSql(`create index "customer_interactions_external_msg_idx" on "customer_interactions" ("external_message_id") where external_message_id IS NOT NULL;`);
    this.addSql(`create index "customer_interactions_org_tenant_status_idx" on "customer_interactions" ("organization_id", "tenant_id", "status", "scheduled_at");`);
    this.addSql(`create index "customer_interactions_type_idx" on "customer_interactions" ("tenant_id", "organization_id", "interaction_type");`);

    this.addSql(`create table "customer_label_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "user_id" uuid not null, "label_id" uuid not null, "entity_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_label_assignments_entity_idx" on "customer_label_assignments" ("entity_id");`);
    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_unique" unique ("label_id", "entity_id");`);

    this.addSql(`create table "customer_labels" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "user_id" uuid not null, "slug" text not null, "label" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_labels_scope_idx" on "customer_labels" ("organization_id", "tenant_id", "user_id");`);
    this.addSql(`alter table "customer_labels" add constraint "customer_labels_unique" unique ("user_id", "tenant_id", "organization_id", "slug");`);

    this.addSql(`create table "customer_people" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "first_name" text null, "last_name" text null, "preferred_name" text null, "job_title" text null, "department" text null, "seniority" text null, "timezone" text null, "linked_in_url" text null, "twitter_url" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, "company_entity_id" uuid null, primary key ("id"));`);
    this.addSql(`alter table "customer_people" add constraint "customer_people_entity_id_unique" unique ("entity_id");`);
    this.addSql(`create index "customer_people_org_tenant_idx" on "customer_people" ("organization_id", "tenant_id");`);
    this.addSql(`create index "idx_customer_people_entity_id" on "customer_people" ("entity_id");`);

    this.addSql(`create table "customer_person_company_links" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "is_primary" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "person_entity_id" uuid not null, "company_entity_id" uuid not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "customer_person_company_links_active_unique" on "customer_person_company_links" ("person_entity_id", "company_entity_id") where deleted_at IS NULL;`);
    this.addSql(`create index "customer_person_company_links_company_idx" on "customer_person_company_links" ("company_entity_id");`);
    this.addSql(`create index "customer_person_company_links_person_idx" on "customer_person_company_links" ("person_entity_id");`);
    this.addSql(`create index "customer_person_company_links_scope_idx" on "customer_person_company_links" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_person_company_roles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "person_entity_id" uuid not null, "company_entity_id" uuid not null, "role_value" text not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_pcr_person_company_idx" on "customer_person_company_roles" ("person_entity_id", "company_entity_id");`);
    this.addSql(`create index "customer_pcr_scope_idx" on "customer_person_company_roles" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_pcr_unique" unique ("person_entity_id", "company_entity_id", "role_value");`);

    this.addSql(`create table "customer_pipeline_stages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid not null, "name" text not null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_pipeline_stages_org_tenant_idx" on "customer_pipeline_stages" ("organization_id", "tenant_id");`);
    this.addSql(`CREATE INDEX customer_pipeline_stages_pipeline_position_idx ON public.customer_pipeline_stages USING btree (pipeline_id, "position");`);

    this.addSql(`create table "customer_pipelines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "is_default" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_pipelines_org_tenant_idx" on "customer_pipelines" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_role_acls" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_portal_admin" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "customer_role_acls" add constraint "customer_role_acls_role_tenant_uniq" unique ("role_id", "tenant_id");`);

    this.addSql(`create table "customer_roles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "slug" text not null, "description" text null, "is_default" bool not null default false, "is_system" bool not null default false, "customer_assignable" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "customer_roles" add constraint "customer_roles_tenant_slug_uniq" unique ("tenant_id", "slug");`);

    this.addSql(`create table "customer_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "address_format" text not null default 'line_first', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "stuck_threshold_days" int4 not null default 14, "dictionary_sort_modes" jsonb null, primary key ("id"));`);
    this.addSql(`alter table "customer_settings" add constraint "customer_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "tag_id" uuid not null, "entity_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "customer_tag_assignments_entity_idx" on "customer_tag_assignments" ("entity_id");`);
    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_unique" unique ("tag_id", "entity_id");`);

    this.addSql(`create table "customer_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "customer_tags" add constraint "customer_tags_org_slug_unique" unique ("organization_id", "tenant_id", "slug");`);
    this.addSql(`create index "customer_tags_org_tenant_idx" on "customer_tags" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_todo_links" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "todo_id" uuid not null, "todo_source" text not null default 'customers:interaction', "created_at" timestamptz(6) not null, "created_by_user_id" uuid null, "entity_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "customer_todo_links_entity_created_idx" on "customer_todo_links" ("entity_id", "created_at");`);
    this.addSql(`create index "customer_todo_links_entity_idx" on "customer_todo_links" ("entity_id");`);
    this.addSql(`alter table "customer_todo_links" add constraint "customer_todo_links_unique" unique ("entity_id", "todo_id", "todo_source");`);

    this.addSql(`create table "customer_user_acls" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_portal_admin" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "customer_user_acls" add constraint "customer_user_acls_user_tenant_uniq" unique ("user_id", "tenant_id");`);

    this.addSql(`create table "customer_user_email_verifications" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "purpose" text not null default 'email_verification', "expires_at" timestamptz(6) not null, "used_at" timestamptz(6) null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_user_email_verifications_token_idx" on "customer_user_email_verifications" ("token");`);

    this.addSql(`create table "customer_user_invitations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "email" text not null, "email_hash" text not null, "token" text not null, "customer_entity_id" uuid null, "role_ids_json" jsonb null, "invited_by_user_id" uuid null, "invited_by_customer_user_id" uuid null, "display_name" text null, "expires_at" timestamptz(6) not null, "accepted_at" timestamptz(6) null, "cancelled_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "person_entity_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "customer_user_invitations_tenant_email_hash_idx" on "customer_user_invitations" ("tenant_id", "email_hash");`);
    this.addSql(`create index "customer_user_invitations_token_idx" on "customer_user_invitations" ("token");`);

    this.addSql(`create table "customer_user_password_resets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "used_at" timestamptz(6) null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "customer_user_password_resets_token_idx" on "customer_user_password_resets" ("token");`);

    this.addSql(`create table "customer_user_roles" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "role_id" uuid not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "customer_user_roles" add constraint "customer_user_roles_user_role_uniq" unique ("user_id", "role_id");`);

    this.addSql(`create table "customer_user_sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token_hash" text not null, "ip_address" text null, "user_agent" text null, "expires_at" timestamptz(6) not null, "last_used_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "customer_user_sessions_token_hash_idx" on "customer_user_sessions" ("token_hash");`);

    this.addSql(`create table "customer_users" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "email" text not null, "email_hash" text not null, "password_hash" text null, "display_name" text not null, "email_verified_at" timestamptz(6) null, "failed_login_attempts" int4 not null default 0, "locked_until" timestamptz(6) null, "last_login_at" timestamptz(6) null, "person_entity_id" uuid null, "customer_entity_id" uuid null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, "sessions_revoked_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "customer_users_customer_entity_idx" on "customer_users" ("customer_entity_id");`);
    this.addSql(`create index "customer_users_email_hash_idx" on "customer_users" ("email_hash");`);
    this.addSql(`create index "customer_users_person_entity_idx" on "customer_users" ("person_entity_id");`);
    this.addSql(`alter table "customer_users" add constraint "customer_users_tenant_email_hash_uniq" unique ("tenant_id", "email_hash");`);

    this.addSql(`create table "dashboard_layouts" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "layout_json" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "dashboard_layouts" add constraint "dashboard_layouts_user_id_tenant_id_organization_id_unique" unique ("user_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "dashboard_role_widgets" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "widget_ids_json" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "dashboard_role_widgets" add constraint "dashboard_role_widgets_role_id_tenant_id_organization_id_unique" unique ("role_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "dashboard_user_widgets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "mode" text not null default 'inherit', "widget_ids_json" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "dashboard_user_widgets" add constraint "dashboard_user_widgets_user_id_tenant_id_organization_id_unique" unique ("user_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "dictionaries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "is_system" bool not null default false, "is_active" bool not null default true, "manager_visibility" text not null default 'default', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "entry_sort_mode" text not null default 'label_asc', primary key ("id"));`);
    this.addSql(`alter table "dictionaries" add constraint "dictionaries_scope_key_unique" unique ("organization_id", "tenant_id", "key");`);

    this.addSql(`create table "dictionary_entries" ("id" uuid not null default gen_random_uuid(), "dictionary_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "value" text not null, "normalized_value" text not null, "label" text not null, "color" text null, "icon" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "position" int4 not null default 0, "is_default" bool not null default false, primary key ("id"));`);
    this.addSql(`create unique index "dictionary_entries_one_default_per_dict" on "dictionary_entries" ("dictionary_id", "organization_id", "tenant_id") where is_default = true;`);
    this.addSql(`create index "dictionary_entries_scope_idx" on "dictionary_entries" ("dictionary_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "dictionary_entries" add constraint "dictionary_entries_unique" unique ("dictionary_id", "organization_id", "tenant_id", "normalized_value");`);

    this.addSql(`create table "domain_mappings" ("id" uuid not null default gen_random_uuid(), "hostname" text not null, "tenant_id" uuid not null, "organization_id" uuid not null, "replaces_domain_id" uuid null, "provider" text not null default 'traefik', "status" text not null default 'pending', "verified_at" timestamptz(6) null, "last_dns_check_at" timestamptz(6) null, "dns_failure_reason" varchar(500) null, "tls_failure_reason" varchar(500) null, "tls_retry_count" int4 not null default 0, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "domain_mappings_hostname_unique" on "domain_mappings" ("hostname");`);
    this.addSql(`create index "domain_mappings_organization_id_idx" on "domain_mappings" ("organization_id");`);
    this.addSql(`create index "domain_mappings_pending_tls_idx" on "domain_mappings" ("status", "updated_at") where status = ANY (ARRAY['verified'::text, 'tls_failed'::text]);`);
    this.addSql(`create index "domain_mappings_pending_verification_idx" on "domain_mappings" ("status", "last_dns_check_at") where status = ANY (ARRAY['pending'::text, 'dns_failed'::text]);`);
    this.addSql(`create unique index "domain_mappings_replaces_domain_id_unique" on "domain_mappings" ("replaces_domain_id") where replaces_domain_id IS NOT NULL;`);
    this.addSql(`create index "domain_mappings_tenant_id_idx" on "domain_mappings" ("tenant_id");`);

    this.addSql(`create table "encryption_maps" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "tenant_id" uuid null, "organization_id" uuid null, "fields_json" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "encryption_maps_entity_scope_idx" on "encryption_maps" ("entity_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "entity_index_coverage" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "tenant_id" uuid null, "organization_id" uuid null, "with_deleted" bool not null default false, "base_count" int4 not null default 0, "indexed_count" int4 not null default 0, "vector_indexed_count" int4 not null default 0, "refreshed_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "entity_index_coverage" add constraint "entity_index_coverage_scope_idx" unique ("entity_type", "tenant_id", "organization_id", "with_deleted");`);

    this.addSql(`create table "entity_index_jobs" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "organization_id" uuid null, "tenant_id" uuid null, "partition_index" int4 null, "partition_count" int4 null, "processed_count" int4 null, "total_count" int4 null, "heartbeat_at" timestamptz(6) null, "status" text not null, "started_at" timestamptz(6) not null, "finished_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "entity_index_jobs_org_idx" on "entity_index_jobs" ("organization_id");`);
    this.addSql(`CREATE UNIQUE INDEX entity_index_jobs_scope_unique ON public.entity_index_jobs USING btree (entity_type, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(partition_index, '-1'::integer), COALESCE(partition_count, '-1'::integer));`);
    this.addSql(`create index "entity_index_jobs_type_idx" on "entity_index_jobs" ("entity_type");`);

    this.addSql(`create table "entity_indexes" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "doc" jsonb not null, "embedding" jsonb null, "index_version" int4 not null default 1, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "organization_id_coalesced" uuid generated always as COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid) stored not null, primary key ("id"));`);
    this.addSql(`create index "entity_indexes_customer_company_profile_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where (deleted_at IS NULL) AND (entity_type = 'customers:customer_company_profile'::text) AND (organization_id IS NOT NULL) AND (tenant_id IS NOT NULL);`);
    this.addSql(`create index "entity_indexes_customer_company_profile_tenant_doc_idx" on "entity_indexes" ("tenant_id", "entity_id") include ("doc") where (deleted_at IS NULL) AND (entity_type = 'customers:customer_company_profile'::text) AND (organization_id IS NULL) AND (tenant_id IS NOT NULL);`);
    this.addSql(`create index "entity_indexes_customer_entity_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where (deleted_at IS NULL) AND (entity_type = 'customers:customer_entity'::text) AND (organization_id IS NOT NULL) AND (tenant_id IS NOT NULL);`);
    this.addSql(`create index "entity_indexes_customer_entity_tenant_doc_idx" on "entity_indexes" ("tenant_id", "entity_id") include ("doc") where (deleted_at IS NULL) AND (entity_type = 'customers:customer_entity'::text) AND (organization_id IS NULL) AND (tenant_id IS NOT NULL);`);
    this.addSql(`create index "entity_indexes_customer_person_profile_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where (deleted_at IS NULL) AND (entity_type = 'customers:customer_person_profile'::text) AND (organization_id IS NOT NULL) AND (tenant_id IS NOT NULL);`);
    this.addSql(`create index "entity_indexes_customer_person_profile_tenant_doc_idx" on "entity_indexes" ("tenant_id", "entity_id") include ("doc") where (deleted_at IS NULL) AND (entity_type = 'customers:customer_person_profile'::text) AND (organization_id IS NULL) AND (tenant_id IS NOT NULL);`);
    this.addSql(`create index "entity_indexes_entity_idx" on "entity_indexes" ("entity_id");`);
    this.addSql(`create index "entity_indexes_org_idx" on "entity_indexes" ("organization_id");`);
    this.addSql(`alter table "entity_indexes" add constraint "entity_indexes_type_entity_org_coalesced_unique" unique ("entity_type", "entity_id", "organization_id_coalesced");`);
    this.addSql(`create index "entity_indexes_type_idx" on "entity_indexes" ("entity_type");`);
    this.addSql(`create index "entity_indexes_type_tenant_idx" on "entity_indexes" ("entity_type", "tenant_id");`);

    this.addSql(`create table "entity_translations" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "translations" jsonb not null default '{}', "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));`);
    this.addSql(`create index "entity_translations_entity_idx" on "entity_translations" ("entity_id");`);
    this.addSql(`CREATE UNIQUE INDEX entity_translations_scope_uq ON public.entity_translations USING btree (entity_type, entity_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));`);
    this.addSql(`create index "entity_translations_type_idx" on "entity_translations" ("entity_type");`);
    this.addSql(`create index "entity_translations_type_tenant_idx" on "entity_translations" ("entity_type", "tenant_id");`);

    this.addSql(`create table "eudr_due_diligence_statements" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "commodity" text not null, "reference_number" text null, "verification_number" text null, "status" text not null default 'draft', "quantity_kg" numeric(14,3) null, "order_id" uuid null, "notes" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "activity_type" text null, "actor_role" text null, "referenced_statements" jsonb not null default '[]', "supplementary_unit" text null, "supplementary_quantity" numeric(14,3) null, "submitted_at" timestamptz(6) null, "reference_issued_at" timestamptz(6) null, "order_snapshot" jsonb null, primary key ("id"));`);
    this.addSql(`create index "eudr_dds_tenant_org_submitted_idx" on "eudr_due_diligence_statements" ("tenant_id", "organization_id", "submitted_at") where deleted_at IS NULL;`);

    this.addSql(`create table "eudr_evidence_submissions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "supplier_entity_id" uuid not null, "supplier_snapshot" jsonb null, "commodity" text not null, "product_mapping_id" uuid null, "statement_id" uuid null, "origin_country" text null, "geolocation" jsonb null, "quantity_kg" numeric(14,3) null, "batch_number" text null, "harvest_from" timestamptz(6) null, "harvest_to" timestamptz(6) null, "producer_name" text null, "attachment_ids" jsonb not null default '[]', "status" text not null default 'draft', "completeness_score" int4 not null default 0, "missing_fields" jsonb not null default '[]', "notes" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "plot_ids" jsonb not null default '[]', primary key ("id"));`);
    this.addSql(`create index "idx_eudr_submissions_statement" on "eudr_evidence_submissions" ("statement_id");`);
    this.addSql(`create index "idx_eudr_submissions_supplier" on "eudr_evidence_submissions" ("supplier_entity_id");`);

    this.addSql(`create table "eudr_mitigation_actions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "risk_assessment_id" uuid not null, "action_type" text not null default 'other', "title" text not null, "description" text null, "status" text not null default 'planned', "due_date" timestamptz(6) null, "completed_at" timestamptz(6) null, "notes" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "idx_eudr_mitigation_actions_risk_assessment" on "eudr_mitigation_actions" ("risk_assessment_id");`);

    this.addSql(`create table "eudr_plots" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "supplier_entity_id" uuid not null, "supplier_snapshot" jsonb null, "name" text not null, "external_id" text null, "description" text null, "origin_country" text not null, "plot_type" text not null default 'point', "geometry" jsonb not null, "area_ha" numeric(12,4) null, "validation_warnings" jsonb not null default '[]', "producer_name" text null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "idx_eudr_plots_supplier" on "eudr_plots" ("supplier_entity_id");`);

    this.addSql(`create table "eudr_product_mappings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "product_snapshot" jsonb null, "commodity" text not null, "hs_code" text null, "is_in_scope" bool not null default true, "notes" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "species_scientific_name" text null, "species_common_name" text null, primary key ("id"));`);
    this.addSql(`create unique index "idx_eudr_mappings_org_product_commodity_unique" on "eudr_product_mappings" ("organization_id", "product_id", "commodity") where deleted_at IS NULL;`);

    this.addSql(`create table "eudr_risk_assessments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "statement_id" uuid not null, "country_risks" jsonb not null default '[]', "overall_tier" text not null default 'unknown', "criteria" jsonb not null default '{}', "conclusion" text not null default 'non_negligible', "is_simplified" bool not null default false, "assessed_at" timestamptz(6) not null, "assessed_by_name" text null, "review_due_at" timestamptz(6) null, "notes" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "idx_eudr_risk_assessments_statement" on "eudr_risk_assessments" ("statement_id");`);

    this.addSql(`create table "example_customer_interaction_mappings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "interaction_id" uuid not null, "todo_id" uuid not null, "sync_status" text not null default 'pending', "last_synced_at" timestamptz(6) null, "last_error" text null, "source_updated_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "example_customer_interaction_mappings" add constraint "example_customer_interaction_mappings_interaction_unique" unique ("organization_id", "tenant_id", "interaction_id");`);
    this.addSql(`create index "example_customer_interaction_mappings_status_idx" on "example_customer_interaction_mappings" ("organization_id", "tenant_id", "sync_status", "updated_at");`);
    this.addSql(`alter table "example_customer_interaction_mappings" add constraint "example_customer_interaction_mappings_todo_unique" unique ("organization_id", "tenant_id", "todo_id");`);

    this.addSql(`create table "example_customer_priorities" ("id" uuid not null default gen_random_uuid(), "customer_id" uuid not null, "priority" text not null default 'normal', "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "example_customer_priorities_customer_idx" on "example_customer_priorities" ("customer_id");`);
    this.addSql(`create index "example_customer_priorities_org_tenant_idx" on "example_customer_priorities" ("organization_id", "tenant_id");`);

    this.addSql(`create table "example_items" ("id" uuid not null default gen_random_uuid(), "title" text not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);

    this.addSql(`create table "example_todo_bulk_operations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "idempotency_key" text not null, "todo_ids" jsonb not null, "progress_job_id" uuid not null, "status" text not null default 'pending', "published_at" timestamptz(6) null, "publish_attempts" int4 not null default 0, "last_publish_attempt_at" timestamptz(6) null, "lease_owner" text null, "lease_expires_at" timestamptz(6) null, "next_item_index" int4 not null default 0, "succeeded_count" int4 not null default 0, "failed_count" int4 not null default 0, "failed_items" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "example_todo_bulk_operations" add constraint "example_todo_bulk_operations_tenant_id_organizati_e950a_unique" unique ("tenant_id", "organization_id", "user_id", "idempotency_key");`);

    this.addSql(`create table "exchange_rates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "from_currency_code" text not null, "to_currency_code" text not null, "rate" numeric(18,8) not null, "date" timestamptz(6) not null, "source" text not null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "type" text null, primary key ("id"));`);
    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_datetime_source_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "date", "source");`);
    this.addSql(`create index "exchange_rates_pair_idx" on "exchange_rates" ("from_currency_code", "to_currency_code", "date");`);
    this.addSql(`create index "exchange_rates_scope_idx" on "exchange_rates" ("organization_id", "tenant_id");`);

    this.addSql(`create table "external_conversations" ("id" uuid not null default gen_random_uuid(), "channel_id" uuid not null, "external_conversation_id" text not null, "subject" text null, "contact_person_id" uuid null, "assigned_user_id" uuid null, "last_message_at" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "external_conversations_assigned_user_idx" on "external_conversations" ("assigned_user_id");`);
    this.addSql(`alter table "external_conversations" add constraint "external_conversations_channel_external_uq" unique ("channel_id", "external_conversation_id");`);
    this.addSql(`create index "external_conversations_channel_idx" on "external_conversations" ("channel_id", "external_conversation_id");`);
    this.addSql(`create index "external_conversations_contact_person_idx" on "external_conversations" ("contact_person_id");`);

    this.addSql(`create table "external_messages" ("id" uuid not null default gen_random_uuid(), "channel_id" uuid not null, "conversation_id" uuid not null, "external_message_id" text not null, "direction" text not null, "sender_identifier" text null, "sender_display_name" text null, "provider_timestamp" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "external_messages_channel_external_idx" on "external_messages" ("channel_id", "external_message_id");`);
    this.addSql(`alter table "external_messages" add constraint "external_messages_channel_external_uq" unique ("channel_id", "external_message_id");`);
    this.addSql(`create index "external_messages_conversation_idx" on "external_messages" ("conversation_id");`);

    this.addSql(`create table "feature_toggle_audit_logs" ("id" uuid not null default gen_random_uuid(), "toggle_id" uuid not null, "organization_id" uuid null, "actor_user_id" uuid null, "action" text not null, "previous_value" jsonb null, "new_value" jsonb null, "changed_fields" jsonb null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "feature_toggle_audit_action_idx" on "feature_toggle_audit_logs" ("action", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_actor_idx" on "feature_toggle_audit_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_org_idx" on "feature_toggle_audit_logs" ("organization_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_toggle_idx" on "feature_toggle_audit_logs" ("toggle_id", "created_at");`);

    this.addSql(`create table "feature_toggle_overrides" ("id" uuid not null default gen_random_uuid(), "toggle_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "value" jsonb not null, primary key ("id"));`);
    this.addSql(`create index "feature_toggle_overrides_tenant_idx" on "feature_toggle_overrides" ("tenant_id");`);
    this.addSql(`create index "feature_toggle_overrides_toggle_idx" on "feature_toggle_overrides" ("toggle_id");`);
    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_tenant_unique" unique ("toggle_id", "tenant_id");`);

    this.addSql(`create table "feature_toggles" ("id" uuid not null default gen_random_uuid(), "identifier" text not null, "name" text not null, "description" text null, "category" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "default_value" jsonb not null, "type" text not null, primary key ("id"));`);
    this.addSql(`create index "feature_toggles_category_idx" on "feature_toggles" ("category");`);
    this.addSql(`alter table "feature_toggles" add constraint "feature_toggles_identifier_unique" unique ("identifier");`);
    this.addSql(`create index "feature_toggles_name_idx" on "feature_toggles" ("name");`);

    this.addSql(`create table "gateway_payment_operations" ("id" uuid not null default gen_random_uuid(), "operation_id" text not null, "transaction_id" uuid not null, "operation_type" text not null, "provider_key" text not null, "request_hash" text not null, "provider_idempotency_key" text not null, "status" text not null default 'in_progress', "attempt_token" text not null, "attempt_count" int4 not null default 1, "result" jsonb null, "lease_expires_at" timestamptz(6) null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "reserved_amount" numeric(18,4) null, primary key ("id"));`);
    this.addSql(`alter table "gateway_payment_operations" add constraint "gateway_payment_operations_scope_operation_unique" unique ("operation_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "gateway_payment_operations_status_lease_expires_at_index" on "gateway_payment_operations" ("status", "lease_expires_at");`);
    this.addSql(`create index "gateway_payment_operations_transaction_id_operatio_615c8_index" on "gateway_payment_operations" ("transaction_id", "operation_type", "organization_id", "tenant_id");`);

    this.addSql(`create table "gateway_session_initializations" ("id" uuid not null default gen_random_uuid(), "operation_key" text not null, "provider_key" text not null, "claim_token" uuid null, "claimed_at" timestamptz(6) null, "gateway_transaction_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "gateway_session_initializations_prune_idx" on "gateway_session_initializations" ("tenant_id", "organization_id", "updated_at") where gateway_transaction_id IS NOT NULL;`);
    this.addSql(`alter table "gateway_session_initializations" add constraint "gateway_session_initializations_scope_operation_unique" unique ("operation_key", "provider_key", "organization_id", "tenant_id");`);

    this.addSql(`create table "gateway_transactions" ("id" uuid not null default gen_random_uuid(), "payment_id" uuid not null, "provider_key" text not null, "provider_session_id" text null, "gateway_payment_id" text null, "gateway_refund_id" text null, "unified_status" text not null default 'pending', "gateway_status" text null, "redirect_url" text null, "client_secret" text null, "amount" numeric(18,4) not null, "currency_code" text not null, "gateway_metadata" jsonb null, "webhook_log" jsonb null, "last_webhook_at" timestamptz(6) null, "last_polled_at" timestamptz(6) null, "expires_at" timestamptz(6) null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "captured_amount" numeric(18,4) not null default '0', primary key ("id"));`);
    this.addSql(`create index "gateway_transactions_organization_id_tenant_id_uni_5a9b9_index" on "gateway_transactions" ("organization_id", "tenant_id", "unified_status");`);
    this.addSql(`create index "gateway_transactions_payment_id_organization_id_tenant_id_index" on "gateway_transactions" ("payment_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "gateway_transactions_provider_key_provider_session_d8577_index" on "gateway_transactions" ("provider_key", "provider_session_id", "organization_id");`);

    this.addSql(`create table "gateway_webhook_events" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "idempotency_key" text not null, "event_type" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "processed_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "gateway_webhook_events_idempotency_unique" on "gateway_webhook_events" ("idempotency_key", "provider_key", "organization_id", "tenant_id");`);

    this.addSql(`create table "inbox_discrepancies" ("id" uuid not null default gen_random_uuid(), "proposal_id" uuid not null, "action_id" uuid null, "type" text not null, "severity" text not null, "description" text not null, "expected_value" text null, "found_value" text null, "resolved" bool not null default false, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "inbox_discrepancies_organization_id_tenant_id_index" on "inbox_discrepancies" ("organization_id", "tenant_id");`);
    this.addSql(`create index "inbox_discrepancies_proposal_id_index" on "inbox_discrepancies" ("proposal_id");`);

    this.addSql(`create table "inbox_emails" ("id" uuid not null default gen_random_uuid(), "message_id" text null, "content_hash" text null, "forwarded_by_address" text not null, "forwarded_by_name" text null, "to_address" text not null, "subject" text not null, "reply_to" text null, "in_reply_to" text null, "references" jsonb null, "raw_text" text null, "raw_html" text null, "cleaned_text" text null, "thread_messages" jsonb null, "detected_language" text null, "attachment_ids" jsonb null, "received_at" timestamptz(6) not null, "status" text not null default 'received', "processing_error" text null, "is_active" bool not null default true, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "inbox_emails" add constraint "inbox_emails_organization_id_tenant_id_content_hash_unique" unique ("organization_id", "tenant_id", "content_hash");`);
    this.addSql(`create index "inbox_emails_organization_id_tenant_id_index" on "inbox_emails" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "inbox_emails" add constraint "inbox_emails_organization_id_tenant_id_message_id_unique" unique ("organization_id", "tenant_id", "message_id");`);
    this.addSql(`create index "inbox_emails_organization_id_tenant_id_received_at_index" on "inbox_emails" ("organization_id", "tenant_id", "received_at");`);
    this.addSql(`create index "inbox_emails_organization_id_tenant_id_status_index" on "inbox_emails" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "inbox_proposal_actions" ("id" uuid not null default gen_random_uuid(), "proposal_id" uuid not null, "sort_order" int4 not null, "action_type" text not null, "description" text not null, "payload" jsonb not null, "status" text not null default 'pending', "confidence" numeric(3,2) not null, "required_feature" text null, "matched_entity_id" uuid null, "matched_entity_type" text null, "created_entity_id" uuid null, "created_entity_type" text null, "execution_error" text null, "executed_at" timestamptz(6) null, "executed_by_user_id" uuid null, "is_active" bool not null default true, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "inbox_proposal_actions_organization_id_tenant_id_status_index" on "inbox_proposal_actions" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "inbox_proposal_actions_proposal_id_index" on "inbox_proposal_actions" ("proposal_id");`);

    this.addSql(`create table "inbox_proposals" ("id" uuid not null default gen_random_uuid(), "inbox_email_id" uuid not null, "summary" text not null, "participants" jsonb not null, "confidence" numeric(3,2) not null, "detected_language" text null, "status" text not null default 'pending', "possibly_incomplete" bool not null default false, "reviewed_by_user_id" uuid null, "reviewed_at" timestamptz(6) null, "llm_model" text null, "llm_tokens_used" int4 null, "is_active" bool not null default true, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "working_language" text null, "translations" jsonb null, "category" text null, primary key ("id"));`);
    this.addSql(`create index "inbox_proposals_inbox_email_id_index" on "inbox_proposals" ("inbox_email_id");`);
    this.addSql(`create index "inbox_proposals_organization_id_tenant_id_category_index" on "inbox_proposals" ("organization_id", "tenant_id", "category");`);
    this.addSql(`create index "inbox_proposals_organization_id_tenant_id_index" on "inbox_proposals" ("organization_id", "tenant_id");`);
    this.addSql(`create index "inbox_proposals_organization_id_tenant_id_status_index" on "inbox_proposals" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "inbox_settings" ("id" uuid not null default gen_random_uuid(), "inbox_address" text not null, "is_active" bool not null default true, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "working_language" text not null default 'en', "webhook_secret" text null, primary key ("id"));`);
    this.addSql(`alter table "inbox_settings" add constraint "inbox_settings_inbox_address_unique" unique ("inbox_address");`);
    this.addSql(`create index "inbox_settings_organization_id_tenant_id_index" on "inbox_settings" ("organization_id", "tenant_id");`);

    this.addSql(`create table "indexer_error_logs" ("id" uuid not null default gen_random_uuid(), "source" text not null, "handler" text not null, "entity_type" text null, "record_id" text null, "tenant_id" uuid null, "organization_id" uuid null, "payload" jsonb null, "message" text not null, "stack" text null, "occurred_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "indexer_error_logs_occurred_idx" on "indexer_error_logs" ("occurred_at");`);
    this.addSql(`create index "indexer_error_logs_source_idx" on "indexer_error_logs" ("source");`);

    this.addSql(`create table "indexer_status_logs" ("id" uuid not null default gen_random_uuid(), "source" text not null, "handler" text not null, "level" text not null default 'info', "entity_type" text null, "record_id" text null, "tenant_id" uuid null, "organization_id" uuid null, "message" text not null, "details" jsonb null, "occurred_at" timestamptz(6) not null default now(), primary key ("id"));`);
    this.addSql(`create index "indexer_status_logs_occurred_idx" on "indexer_status_logs" ("occurred_at");`);
    this.addSql(`create index "indexer_status_logs_source_idx" on "indexer_status_logs" ("source");`);

    this.addSql(`create table "integration_credentials" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "credentials" jsonb not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "user_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "integration_credentials_integration_id_organizatio_291ea_index" on "integration_credentials" ("integration_id", "organization_id", "tenant_id");`);
    this.addSql(`create unique index "integration_credentials_user_lookup_idx" on "integration_credentials" ("integration_id", "organization_id", "tenant_id", "user_id") where (user_id IS NOT NULL) AND (deleted_at IS NULL);`);

    this.addSql(`create table "integration_logs" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "run_id" uuid null, "scope_entity_type" text null, "scope_entity_id" uuid null, "level" text not null, "message" text not null, "code" text null, "payload" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "integration_logs_integration_id_organization_id_te_38189_index" on "integration_logs" ("integration_id", "organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index "integration_logs_level_organization_id_tenant_id_c_107e7_index" on "integration_logs" ("level", "organization_id", "tenant_id", "created_at");`);

    this.addSql(`create table "integration_states" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "is_enabled" bool not null default true, "api_version" text null, "reauth_required" bool not null default false, "last_health_status" text null, "last_health_checked_at" timestamptz(6) null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "last_health_latency_ms" int4 null, "enabled_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "integration_states_integration_id_organization_id__32acc_index" on "integration_states" ("integration_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "message_access_tokens" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "recipient_user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "used_at" timestamptz(6) null, "use_count" int4 not null default 0, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "message_access_tokens_message_idx" on "message_access_tokens" ("message_id");`);
    this.addSql(`create index "message_access_tokens_token_idx" on "message_access_tokens" ("token");`);
    this.addSql(`alter table "message_access_tokens" add constraint "message_access_tokens_token_unique" unique ("token");`);

    this.addSql(`create table "message_channel_links" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "external_conversation_id" uuid not null, "external_message_id" uuid null, "provider_key" text not null, "channel_type" text not null, "direction" text not null, "delivery_status" text not null default 'pending', "channel_payload" jsonb null, "channel_content_type" text null, "interactive_state" jsonb null, "channel_metadata" jsonb null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "message_channel_links_ext_conv_idx" on "message_channel_links" ("external_conversation_id");`);
    this.addSql(`create index "message_channel_links_ext_msg_idx" on "message_channel_links" ("external_message_id");`);
    this.addSql(`create index "message_channel_links_message_idx" on "message_channel_links" ("message_id");`);
    this.addSql(`alter table "message_channel_links" add constraint "message_channel_links_message_uq" unique ("message_id");`);

    this.addSql(`create table "message_confirmations" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid null, "confirmed" bool not null default true, "confirmed_by_user_id" uuid null, "confirmed_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "message_confirmations_message_idx" on "message_confirmations" ("message_id");`);
    this.addSql(`alter table "message_confirmations" add constraint "message_confirmations_message_unique" unique ("message_id");`);
    this.addSql(`create index "message_confirmations_scope_idx" on "message_confirmations" ("tenant_id", "organization_id");`);

    this.addSql(`create table "message_objects" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "entity_module" text not null, "entity_type" text not null, "entity_id" uuid not null, "action_required" bool not null default false, "action_type" text null, "action_label" text null, "entity_snapshot" jsonb null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "message_objects_entity_idx" on "message_objects" ("entity_type", "entity_id");`);
    this.addSql(`create index "message_objects_message_idx" on "message_objects" ("message_id");`);

    this.addSql(`create table "message_reactions" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "emoji" text not null, "reacted_by_user_id" uuid null, "reacted_by_external_id" text null, "reacted_by_display_name" text null, "provider_key" text null, "external_reaction_id" text null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create unique index "message_reactions_external_actor_uq" on "message_reactions" ("tenant_id", "message_id", "emoji", "reacted_by_external_id") where reacted_by_external_id IS NOT NULL;`);
    this.addSql(`create unique index "message_reactions_internal_actor_uq" on "message_reactions" ("tenant_id", "message_id", "emoji", "reacted_by_user_id") where reacted_by_user_id IS NOT NULL;`);
    this.addSql(`create index "message_reactions_message_emoji_idx" on "message_reactions" ("message_id", "emoji");`);
    this.addSql(`create index "message_reactions_message_idx" on "message_reactions" ("message_id");`);

    this.addSql(`create table "message_recipients" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "recipient_user_id" uuid not null, "recipient_type" text not null default 'to', "status" text not null default 'unread', "read_at" timestamptz(6) null, "archived_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, "email_sent_at" timestamptz(6) null, "email_delivered_at" timestamptz(6) null, "email_opened_at" timestamptz(6) null, "email_failed_at" timestamptz(6) null, "email_error" text null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "message_recipients_message_idx" on "message_recipients" ("message_id");`);
    this.addSql(`alter table "message_recipients" add constraint "message_recipients_message_user_unique" unique ("message_id", "recipient_user_id");`);
    this.addSql(`create index "message_recipients_user_idx" on "message_recipients" ("recipient_user_id", "status");`);

    this.addSql(`create table "messages" ("id" uuid not null default gen_random_uuid(), "type" text not null default 'default', "thread_id" uuid null, "parent_message_id" uuid null, "sender_user_id" uuid not null, "subject" text not null, "body" text not null, "body_format" text not null default 'text', "priority" text not null default 'normal', "status" text not null default 'draft', "is_draft" bool not null default true, "sent_at" timestamptz(6) null, "action_data" jsonb null, "action_result" jsonb null, "action_taken" text null, "action_taken_by_user_id" uuid null, "action_taken_at" timestamptz(6) null, "send_via_email" bool not null default false, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "visibility" text null, "source_entity_type" text null, "source_entity_id" uuid null, "external_email" text null, "external_name" text null, "external_email_sent_at" timestamptz(6) null, "external_email_failed_at" timestamptz(6) null, "external_email_error" text null, "external_email_hash" text null, "idempotency_key" text null, primary key ("id"));`);
    this.addSql(`create index "messages_external_email_hash_idx" on "messages" ("external_email_hash");`);
    this.addSql(`create unique index "messages_idempotency_key_uq" on "messages" ("tenant_id", "idempotency_key") where idempotency_key IS NOT NULL;`);
    this.addSql(`create index "messages_sender_idx" on "messages" ("sender_user_id", "sent_at");`);
    this.addSql(`create index "messages_tenant_idx" on "messages" ("tenant_id", "organization_id");`);
    this.addSql(`create index "messages_thread_idx" on "messages" ("thread_id");`);
    this.addSql(`create index "messages_type_idx" on "messages" ("type", "tenant_id");`);

    this.addSql(`create table "mikro_orm_migrations_ai_assistant" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_api_keys" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_attachments" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_audit_logs" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_auth" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_business_rules" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_catalog" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_checkout" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_communication_channels" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_configs" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_currencies" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_customer_accounts" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_customers" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_dashboards" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_data_sync" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_devices" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_dictionaries" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_directory" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_entities" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_eudr" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_example" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_example_customers_sync" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_feature_toggles" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_inbox_ops" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_integrations" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_invoice" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_messages" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_notifications" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_onboarding" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_payment_gateways" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_perspectives" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_planner" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_progress" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_push_notifications" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_query_index" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_resources" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_sales" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_scheduler" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_shipping_carriers" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_staff" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_sync_excel" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_tasks" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_translations" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_warranty_claims" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_webhooks" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_wms" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "mikro_orm_migrations_workflows" ("id" serial primary key, "name" varchar(255) not null, "executed_at" timestamptz(6) not null default current_timestamp(6));`);

    this.addSql(`create table "module_configs" ("id" uuid not null default gen_random_uuid(), "module_id" text not null, "name" text not null, "value_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "organization_id" uuid null, "tenant_id" uuid null, primary key ("id"));`);
    this.addSql(`create unique index "module_configs_global_unique" on "module_configs" ("module_id", "name") where tenant_id IS NULL;`);
    this.addSql(`create index "module_configs_module_idx" on "module_configs" ("module_id");`);
    this.addSql(`create index "module_configs_module_name_tenant_idx" on "module_configs" ("module_id", "name", "tenant_id");`);
    this.addSql(`create unique index "module_configs_scoped_unique" on "module_configs" ("module_id", "name", "tenant_id") where tenant_id IS NOT NULL;`);

    this.addSql(`create table "notification_preferences" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "user_id" uuid not null, "notification_type_id" text not null, "channel" text not null, "enabled" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "notification_preferences_tenant_user_idx" on "notification_preferences" ("tenant_id", "user_id");`);
    this.addSql(`create unique index "notification_preferences_unique" on "notification_preferences" ("tenant_id", "user_id", "notification_type_id", "channel");`);

    this.addSql(`create table "notification_type_overrides" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "notification_type_id" text not null, "channels" jsonb null, "non_opt_out" bool null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create unique index "notification_type_overrides_unique" on "notification_type_overrides" ("tenant_id", "notification_type_id");`);

    this.addSql(`create table "notification_types" ("id" text not null, "tenant_id" uuid null, "label_key" text not null, "description_key" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "non_opt_out" bool not null default false, "category" text null, "silent" bool not null default false, primary key ("id"));`);
    this.addSql(`create index "notification_types_tenant_idx" on "notification_types" ("tenant_id");`);

    this.addSql(`create table "notifications" ("id" uuid not null default gen_random_uuid(), "recipient_user_id" uuid not null, "type" text not null, "title" text not null, "body" text null, "icon" text null, "severity" text not null default 'info', "status" text not null default 'unread', "action_data" jsonb null, "action_result" jsonb null, "action_taken" text null, "source_module" text null, "source_entity_type" text null, "source_entity_id" uuid null, "link_href" text null, "group_key" text null, "created_at" timestamptz(6) not null default now(), "read_at" timestamptz(6) null, "actioned_at" timestamptz(6) null, "dismissed_at" timestamptz(6) null, "expires_at" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid null, "title_key" text null, "body_key" text null, "title_variables" jsonb null, "body_variables" jsonb null, "data" jsonb null, "push_options" jsonb null, "channels" jsonb null, primary key ("id"));`);
    this.addSql(`comment on column "notifications"."title_key" is 'i18n key for notification title';`);
    this.addSql(`comment on column "notifications"."body_key" is 'i18n key for notification body';`);
    this.addSql(`comment on column "notifications"."title_variables" is 'Variables for i18n interpolation in title';`);
    this.addSql(`comment on column "notifications"."body_variables" is 'Variables for i18n interpolation in body';`);
    this.addSql(`create index "notifications_expires_idx" on "notifications" ("expires_at") where (expires_at IS NOT NULL) AND (status <> ALL (ARRAY['actioned'::text, 'dismissed'::text]));`);
    this.addSql(`create index "notifications_group_idx" on "notifications" ("group_key", "recipient_user_id") where group_key IS NOT NULL;`);
    this.addSql(`create index "notifications_recipient_status_idx" on "notifications" ("recipient_user_id", "status", "created_at" DESC);`);
    this.addSql(`create index "notifications_source_idx" on "notifications" ("source_entity_type", "source_entity_id") where source_entity_id IS NOT NULL;`);
    this.addSql(`create index "notifications_tenant_idx" on "notifications" ("tenant_id", "organization_id");`);

    this.addSql(`create table "onboarding_requests" ("id" uuid not null default gen_random_uuid(), "email" text not null, "token_hash" text not null, "status" text not null default 'pending', "first_name" text not null, "last_name" text not null, "organization_name" text not null, "locale" text null, "terms_accepted" bool not null default false, "password_hash" text null, "expires_at" timestamptz(6) not null, "completed_at" timestamptz(6) null, "tenant_id" uuid null, "organization_id" uuid null, "user_id" uuid null, "last_email_sent_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, "processing_started_at" timestamptz(6) null, "marketing_consent" bool null default false, "preparation_completed_at" timestamptz(6) null, "ready_email_sent_at" timestamptz(6) null, "preparation_started_at" timestamptz(6) null, "email_hash" text null, primary key ("id"));`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_email_hash_unique" unique ("email_hash");`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_email_unique" unique ("email");`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_token_hash_unique" unique ("token_hash");`);

    this.addSql(`create table "organizations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "name" text not null, "is_active" bool not null default true, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int4 not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "slug" text null, "logo_url" text null, "logo_preserve_aspect_ratio" bool not null default false, primary key ("id"));`);
    this.addSql(`alter table "organizations" add constraint "organizations_tenant_slug_uniq" unique ("tenant_id", "slug");`);

    this.addSql(`create table "password_resets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "used_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_unique" unique ("token");`);

    this.addSql(`create table "perspectives" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "table_id" text not null, "name" text not null, "settings_json" jsonb not null, "is_default" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "perspectives_live_user_global_uq" on "perspectives" ("user_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NULL) AND (organization_id IS NULL);`);
    this.addSql(`create unique index "perspectives_live_user_org_only_uq" on "perspectives" ("user_id", "organization_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NULL) AND (organization_id IS NOT NULL);`);
    this.addSql(`create unique index "perspectives_live_user_org_uq" on "perspectives" ("user_id", "tenant_id", "organization_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NOT NULL) AND (organization_id IS NOT NULL);`);
    this.addSql(`create unique index "perspectives_live_user_tenant_uq" on "perspectives" ("user_id", "tenant_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NOT NULL) AND (organization_id IS NULL);`);
    this.addSql(`create index "perspectives_user_scope_idx" on "perspectives" ("user_id", "tenant_id", "organization_id", "table_id");`);

    this.addSql(`create table "planner_availability_rule_sets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "timezone" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "planner_availability_rule_sets_tenant_org_idx" on "planner_availability_rule_sets" ("tenant_id", "organization_id");`);

    this.addSql(`create table "planner_availability_rules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "subject_type" text not null, "subject_id" uuid not null, "timezone" text not null, "rrule" text not null, "exdates" jsonb not null default '[]', "kind" text not null default 'availability', "note" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "unavailability_reason_entry_id" uuid null, "unavailability_reason_value" text null, primary key ("id"));`);
    this.addSql(`create index "planner_availability_rules_subject_idx" on "planner_availability_rules" ("subject_type", "subject_id", "tenant_id", "organization_id");`);
    this.addSql(`create index "planner_availability_rules_tenant_org_idx" on "planner_availability_rules" ("tenant_id", "organization_id");`);

    this.addSql(`create table "progress_jobs" ("id" uuid not null default gen_random_uuid(), "job_type" text not null, "name" text not null, "description" text null, "status" text not null default 'pending', "progress_percent" int2 not null default 0, "processed_count" int4 not null default 0, "total_count" int4 null, "eta_seconds" int4 null, "started_by_user_id" uuid null, "started_at" timestamptz(6) null, "heartbeat_at" timestamptz(6) null, "finished_at" timestamptz(6) null, "result_summary" jsonb null, "error_message" text null, "error_stack" text null, "meta" jsonb null, "cancellable" bool not null default false, "cancelled_by_user_id" uuid null, "cancel_requested_at" timestamptz(6) null, "parent_job_id" uuid null, "partition_index" int4 null, "partition_count" int4 null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "progress_jobs_parent_idx" on "progress_jobs" ("parent_job_id");`);
    this.addSql(`create index "progress_jobs_status_tenant_idx" on "progress_jobs" ("status", "tenant_id");`);
    this.addSql(`create index "progress_jobs_type_tenant_idx" on "progress_jobs" ("job_type", "tenant_id");`);

    this.addSql(`create table "push_notification_deliveries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "notification_id" uuid null, "notification_type_id" text not null, "user_device_id" uuid not null, "user_id" uuid not null, "provider" text not null, "token_snapshot" text not null, "status" text not null default 'pending', "attempts" int4 not null default 0, "last_error" text null, "payload" jsonb not null, "provider_response" jsonb null, "created_at" timestamptz(6) not null, "sent_at" timestamptz(6) null, "next_retry_at" timestamptz(6) null, "updated_at" timestamptz(6) not null, "silent" bool not null default false, primary key ("id"));`);
    this.addSql(`create unique index "push_notification_deliveries_notif_device_unique" on "push_notification_deliveries" ("notification_id", "user_device_id") where notification_id IS NOT NULL;`);
    this.addSql(`create index "push_notification_deliveries_notification_idx" on "push_notification_deliveries" ("notification_id");`);
    this.addSql(`create index "push_notification_deliveries_tenant_status_idx" on "push_notification_deliveries" ("tenant_id", "status", "created_at");`);

    this.addSql(`create table "resources_resource_activities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz(6) null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "resource_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "resources_resource_activities_resource_idx" on "resources_resource_activities" ("resource_id");`);
    this.addSql(`create index "resources_resource_activities_resource_occurred_created_idx" on "resources_resource_activities" ("resource_id", "occurred_at", "created_at");`);
    this.addSql(`create index "resources_resource_activities_tenant_org_idx" on "resources_resource_activities" ("tenant_id", "organization_id");`);

    this.addSql(`create table "resources_resource_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "resource_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "resources_resource_comments_resource_idx" on "resources_resource_comments" ("resource_id");`);
    this.addSql(`create index "resources_resource_comments_tenant_org_idx" on "resources_resource_comments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "resources_resource_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "resource_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "resources_resource_tag_assignments_scope_idx" on "resources_resource_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_unique" unique ("tag_id", "resource_id");`);

    this.addSql(`create table "resources_resource_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "resources_resource_tags_scope_idx" on "resources_resource_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "resources_resource_tags" add constraint "resources_resource_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "resources_resource_types" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "resources_resource_types_tenant_org_idx" on "resources_resource_types" ("tenant_id", "organization_id");`);

    this.addSql(`create table "resources_resources" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "resource_type_id" uuid null, "capacity" int4 null, "capacity_unit_value" text null, "capacity_unit_name" text null, "capacity_unit_color" text null, "capacity_unit_icon" text null, "appearance_icon" text null, "appearance_color" text null, "is_active" bool not null default true, "availability_rule_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "custom_fieldset_code" text null, primary key ("id"));`);
    this.addSql(`create index "resources_resources_tenant_org_idx" on "resources_resources" ("tenant_id", "organization_id");`);

    this.addSql(`create table "role_acls" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" bool not null default false, "organizations_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);

    this.addSql(`create table "role_perspectives" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "table_id" text not null, "name" text not null, "settings_json" jsonb not null, "is_default" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "role_perspectives_live_role_global_uq" on "role_perspectives" ("role_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NULL) AND (organization_id IS NULL);`);
    this.addSql(`create unique index "role_perspectives_live_role_org_only_uq" on "role_perspectives" ("role_id", "organization_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NULL) AND (organization_id IS NOT NULL);`);
    this.addSql(`create unique index "role_perspectives_live_role_org_uq" on "role_perspectives" ("role_id", "tenant_id", "organization_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NOT NULL) AND (organization_id IS NOT NULL);`);
    this.addSql(`create unique index "role_perspectives_live_role_tenant_uq" on "role_perspectives" ("role_id", "tenant_id", "table_id", "name") where (deleted_at IS NULL) AND (tenant_id IS NOT NULL) AND (organization_id IS NULL);`);
    this.addSql(`create index "role_perspectives_role_scope_idx" on "role_perspectives" ("role_id", "tenant_id", "organization_id", "table_id");`);

    this.addSql(`create table "role_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "role_sidebar_preferences_active_unique_idx" on "role_sidebar_preferences" ("role_id", "tenant_id") where deleted_at IS NULL;`);

    this.addSql(`create table "roles" ("id" uuid not null default gen_random_uuid(), "name" text not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "updated_at" timestamptz(6) null, "min_active_holders" int4 not null default 0, primary key ("id"));`);
    this.addSql(`alter table "roles" add constraint "roles_tenant_id_name_unique" unique ("tenant_id", "name");`);

    this.addSql(`create table "rule_execution_logs" ("id" bigserial primary key, "rule_id" uuid not null, "entity_id" varchar(255) not null, "entity_type" varchar(50) not null, "execution_result" varchar(20) not null, "input_context" jsonb null, "output_context" jsonb null, "error_message" text null, "execution_time_ms" int4 not null, "executed_at" timestamptz(6) not null, "tenant_id" uuid not null, "organization_id" uuid null, "executed_by" varchar(50) null);`);
    this.addSql(`create index "rule_execution_logs_entity_idx" on "rule_execution_logs" ("entity_type", "entity_id");`);
    this.addSql(`create index "rule_execution_logs_result_idx" on "rule_execution_logs" ("execution_result", "executed_at");`);
    this.addSql(`create index "rule_execution_logs_rule_idx" on "rule_execution_logs" ("rule_id");`);
    this.addSql(`create index "rule_execution_logs_tenant_org_idx" on "rule_execution_logs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "rule_set_members" ("id" uuid not null default gen_random_uuid(), "rule_set_id" uuid not null, "rule_id" uuid not null, "sequence" int4 not null default 0, "enabled" bool not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "rule_set_members_rule_idx" on "rule_set_members" ("rule_id");`);
    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_set_id_rule_id_unique" unique ("rule_set_id", "rule_id");`);
    this.addSql(`create index "rule_set_members_set_idx" on "rule_set_members" ("rule_set_id", "sequence");`);
    this.addSql(`create index "rule_set_members_tenant_org_idx" on "rule_set_members" ("tenant_id", "organization_id");`);

    this.addSql(`create table "rule_sets" ("id" uuid not null default gen_random_uuid(), "set_id" varchar(50) not null, "set_name" varchar(200) not null, "description" text null, "enabled" bool not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(50) null, "updated_by" varchar(50) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "rule_sets_enabled_idx" on "rule_sets" ("enabled");`);
    this.addSql(`alter table "rule_sets" add constraint "rule_sets_set_id_tenant_id_unique" unique ("set_id", "tenant_id");`);
    this.addSql(`create index "rule_sets_tenant_org_idx" on "rule_sets" ("tenant_id", "organization_id");`);

    this.addSql(`create table "sales_channels" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text null, "description" text null, "status_entry_id" uuid null, "status" text null, "website_url" text null, "contact_email" text null, "contact_phone" text null, "address_line1" text null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "latitude" numeric(10,6) null, "longitude" numeric(10,6) null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sales_channels" add constraint "sales_channels_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_channels_org_tenant_idx" on "sales_channels" ("organization_id", "tenant_id");`);
    this.addSql(`create index "sales_channels_status_idx" on "sales_channels" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_credit_memo_lines" ("id" uuid not null default gen_random_uuid(), "credit_memo_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "description" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "metadata" jsonb null, "normalized_quantity" numeric(18,6) not null default '0', "normalized_unit" text null, "uom_snapshot" jsonb null, "name" text null, "sku" text null, primary key ("id"));`);
    this.addSql(`create index "sales_credit_memo_lines_normalized_idx" on "sales_credit_memo_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);
    this.addSql(`create index "sales_credit_memo_lines_scope_idx" on "sales_credit_memo_lines" ("credit_memo_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_credit_memos" ("id" uuid not null default gen_random_uuid(), "order_id" uuid null, "invoice_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "credit_memo_number" text not null, "status_entry_id" uuid null, "status" text null, "issue_date" timestamptz(6) null, "currency_code" text not null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "reason" text null, primary key ("id"));`);
    this.addSql(`alter table "sales_credit_memos" add constraint "sales_credit_memos_number_unique" unique ("organization_id", "tenant_id", "credit_memo_number");`);
    this.addSql(`create index "sales_credit_memos_scope_idx" on "sales_credit_memos" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_credit_memos_status_idx" on "sales_credit_memos" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_delivery_windows" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "lead_time_days" int4 null, "cutoff_time" text null, "timezone" text null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sales_delivery_windows" add constraint "sales_delivery_windows_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_delivery_windows_scope_idx" on "sales_delivery_windows" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_document_addresses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "document_kind" text not null, "order_id" uuid null, "quote_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "customer_address_id" uuid null, "name" text null, "purpose" text null, "company_name" text null, "address_line1" text not null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "building_number" text null, "flat_number" text null, "latitude" float4 null, "longitude" float4 null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sales_document_addresses_scope_idx" on "sales_document_addresses" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_document_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_kind" text not null, "current_value" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sales_document_sequences" add constraint "sales_document_sequences_scope_unique" unique ("organization_id", "tenant_id", "document_kind");`);

    this.addSql(`create table "sales_document_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "document_id" uuid not null, "document_kind" text not null, "order_id" uuid null, "quote_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "sales_document_tag_assignments_document_idx" on "sales_document_tag_assignments" ("document_id");`);
    this.addSql(`create index "sales_document_tag_assignments_scope_idx" on "sales_document_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_unique" unique ("tag_id", "document_id", "document_kind");`);

    this.addSql(`create table "sales_document_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "sales_document_tags_scope_idx" on "sales_document_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_document_tags" add constraint "sales_document_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "sales_invoice_lines" ("id" uuid not null default gen_random_uuid(), "invoice_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "description" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "metadata" jsonb null, "normalized_quantity" numeric(18,6) not null default '0', "normalized_unit" text null, "uom_snapshot" jsonb null, "name" text null, "sku" text null, primary key ("id"));`);
    this.addSql(`create index "sales_invoice_lines_normalized_idx" on "sales_invoice_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);
    this.addSql(`create index "sales_invoice_lines_scope_idx" on "sales_invoice_lines" ("invoice_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_invoices" ("id" uuid not null default gen_random_uuid(), "order_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "invoice_number" text not null, "status_entry_id" uuid null, "status" text null, "issue_date" timestamptz(6) null, "due_date" timestamptz(6) null, "currency_code" text not null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "paid_total_amount" numeric(18,4) not null default '0', "outstanding_amount" numeric(18,4) not null default '0', "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sales_invoices" add constraint "sales_invoices_number_unique" unique ("organization_id", "tenant_id", "invoice_number");`);
    this.addSql(`create index "sales_invoices_scope_idx" on "sales_invoices" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_invoices_status_idx" on "sales_invoices" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_notes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "context_type" text not null, "context_id" uuid not null, "order_id" uuid null, "quote_id" uuid null, "author_user_id" uuid null, "body" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "appearance_icon" text null, "appearance_color" text null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sales_notes_scope_idx" on "sales_notes" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_order_adjustments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "scope" text not null default 'order', "kind" text not null default 'custom', "code" text null, "label" text null, "calculator_key" text null, "promotion_id" uuid null, "rate" numeric(7,4) not null default '0', "amount_net" numeric(18,4) not null default '0', "amount_gross" numeric(18,4) not null default '0', "currency_code" text null, "metadata" jsonb null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sales_order_adjustments_scope_idx" on "sales_order_adjustments" ("order_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_order_lines" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "status_entry_id" uuid null, "status" text null, "product_id" uuid null, "product_variant_id" uuid null, "catalog_snapshot" jsonb null, "name" text null, "description" text null, "comment" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "reserved_quantity" numeric(18,4) not null default '0', "fulfilled_quantity" numeric(18,4) not null default '0', "invoiced_quantity" numeric(18,4) not null default '0', "returned_quantity" numeric(18,4) not null default '0', "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "configuration" jsonb null, "promotion_code" text null, "promotion_snapshot" jsonb null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "normalized_quantity" numeric(18,6) not null default '0', "normalized_unit" text null, "uom_snapshot" jsonb null, primary key ("id"));`);
    this.addSql(`create index "sales_order_lines_normalized_idx" on "sales_order_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);
    this.addSql(`create index "sales_order_lines_scope_idx" on "sales_order_lines" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_order_lines_status_idx" on "sales_order_lines" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_orders" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_number" text not null, "external_reference" text null, "customer_reference" text null, "customer_entity_id" uuid null, "customer_contact_id" uuid null, "billing_address_id" uuid null, "shipping_address_id" uuid null, "currency_code" text not null, "exchange_rate" numeric(18,8) null, "status_entry_id" uuid null, "status" text null, "fulfillment_status_entry_id" uuid null, "fulfillment_status" text null, "payment_status_entry_id" uuid null, "payment_status" text null, "tax_strategy_key" text null, "discount_strategy_key" text null, "shipping_method_snapshot" jsonb null, "payment_method_snapshot" jsonb null, "placed_at" timestamptz(6) null, "expected_delivery_at" timestamptz(6) null, "due_at" timestamptz(6) null, "comments" text null, "internal_notes" text null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "shipping_net_amount" numeric(18,4) not null default '0', "shipping_gross_amount" numeric(18,4) not null default '0', "surcharge_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "paid_total_amount" numeric(18,4) not null default '0', "refunded_total_amount" numeric(18,4) not null default '0', "outstanding_amount" numeric(18,4) not null default '0', "line_item_count" int4 not null default 0, "metadata" jsonb null, "custom_field_set_id" uuid null, "channel_id" uuid null, "channel_ref_id" uuid null, "shipping_method_id" uuid null, "shipping_method_ref_id" uuid null, "delivery_window_id" uuid null, "delivery_window_ref_id" uuid null, "payment_method_id" uuid null, "payment_method_ref_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "customer_snapshot" jsonb null, "billing_address_snapshot" jsonb null, "shipping_address_snapshot" jsonb null, "tax_info" jsonb null, "delivery_window_snapshot" jsonb null, "shipping_method_code" text null, "delivery_window_code" text null, "payment_method_code" text null, "totals_snapshot" jsonb null, primary key ("id"));`);
    this.addSql(`create index "sales_orders_customer_idx" on "sales_orders" ("customer_entity_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_orders_fulfillment_status_idx" on "sales_orders" ("organization_id", "tenant_id", "fulfillment_status");`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_number_unique" unique ("organization_id", "tenant_id", "order_number");`);
    this.addSql(`create index "sales_orders_org_tenant_idx" on "sales_orders" ("organization_id", "tenant_id");`);
    this.addSql(`create index "sales_orders_payment_status_idx" on "sales_orders" ("organization_id", "tenant_id", "payment_status");`);
    this.addSql(`create index "sales_orders_status_idx" on "sales_orders" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_payment_allocations" ("id" uuid not null default gen_random_uuid(), "payment_id" uuid not null, "order_id" uuid null, "invoice_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "amount" numeric(18,4) not null default '0', "currency_code" text not null, "metadata" jsonb null, primary key ("id"));`);
    this.addSql(`create index "sales_payment_allocations_scope_idx" on "sales_payment_allocations" ("payment_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_payment_methods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "provider_key" text null, "terms" text null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sales_payment_methods" add constraint "sales_payment_methods_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_payment_methods_scope_idx" on "sales_payment_methods" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_payments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid null, "payment_method_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "payment_reference" text null, "status_entry_id" uuid null, "status" text null, "amount" numeric(18,4) not null default '0', "currency_code" text not null, "captured_amount" numeric(18,4) not null default '0', "refunded_amount" numeric(18,4) not null default '0', "received_at" timestamptz(6) null, "captured_at" timestamptz(6) null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sales_payments_scope_idx" on "sales_payments" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_payments_status_idx" on "sales_payments" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_quote_adjustments" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "quote_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "scope" text not null default 'order', "kind" text not null default 'custom', "code" text null, "label" text null, "calculator_key" text null, "promotion_id" uuid null, "rate" numeric(7,4) not null default '0', "amount_net" numeric(18,4) not null default '0', "amount_gross" numeric(18,4) not null default '0', "currency_code" text null, "metadata" jsonb null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sales_quote_adjustments_scope_idx" on "sales_quote_adjustments" ("quote_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_quote_lines" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "status_entry_id" uuid null, "status" text null, "product_id" uuid null, "product_variant_id" uuid null, "catalog_snapshot" jsonb null, "name" text null, "description" text null, "comment" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "configuration" jsonb null, "promotion_code" text null, "promotion_snapshot" jsonb null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "normalized_quantity" numeric(18,6) not null default '0', "normalized_unit" text null, "uom_snapshot" jsonb null, primary key ("id"));`);
    this.addSql(`create index "sales_quote_lines_normalized_idx" on "sales_quote_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);
    this.addSql(`create index "sales_quote_lines_scope_idx" on "sales_quote_lines" ("quote_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_quote_lines_status_idx" on "sales_quote_lines" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_quotes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_number" text not null, "status_entry_id" uuid null, "status" text null, "customer_entity_id" uuid null, "customer_contact_id" uuid null, "currency_code" text not null, "valid_from" timestamptz(6) null, "valid_until" timestamptz(6) null, "comments" text null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "line_item_count" int4 not null default 0, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "converted_order_id" uuid null, "customer_snapshot" jsonb null, "billing_address_id" uuid null, "shipping_address_id" uuid null, "billing_address_snapshot" jsonb null, "shipping_address_snapshot" jsonb null, "tax_info" jsonb null, "shipping_method_id" uuid null, "shipping_method_code" text null, "shipping_method_ref_id" uuid null, "delivery_window_id" uuid null, "delivery_window_code" text null, "delivery_window_ref_id" uuid null, "payment_method_id" uuid null, "payment_method_code" text null, "payment_method_ref_id" uuid null, "shipping_method_snapshot" jsonb null, "delivery_window_snapshot" jsonb null, "payment_method_snapshot" jsonb null, "channel_id" uuid null, "channel_ref_id" uuid null, "external_reference" text null, "customer_reference" text null, "placed_at" timestamptz(6) null, "totals_snapshot" jsonb null, "acceptance_token" text null, "sent_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_acceptance_token_unique" unique ("acceptance_token");`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_number_unique" unique ("organization_id", "tenant_id", "quote_number");`);
    this.addSql(`create index "sales_quotes_scope_idx" on "sales_quotes" ("organization_id", "tenant_id");`);
    this.addSql(`create index "sales_quotes_status_idx" on "sales_quotes" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_return_lines" ("id" uuid not null default gen_random_uuid(), "return_id" uuid not null, "order_line_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "quantity_returned" numeric(18,4) not null default '0', "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sales_return_lines_order_line_idx" on "sales_return_lines" ("order_line_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_return_lines_return_idx" on "sales_return_lines" ("return_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_returns" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "return_number" text not null, "status_entry_id" uuid null, "status" text null, "reason" text null, "notes" text null, "returned_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sales_returns" add constraint "sales_returns_number_unique" unique ("organization_id", "tenant_id", "return_number");`);
    this.addSql(`create index "sales_returns_scope_idx" on "sales_returns" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_returns_status_idx" on "sales_returns" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_number_format" text not null default 'ORDER-{yyyy}{mm}{dd}-{seq:5}', "quote_number_format" text not null default 'QUOTE-{yyyy}{mm}{dd}-{seq:5}', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "order_customer_editable_statuses" jsonb null, "order_address_editable_statuses" jsonb null, primary key ("id"));`);
    this.addSql(`alter table "sales_settings" add constraint "sales_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_shipment_items" ("id" uuid not null default gen_random_uuid(), "shipment_id" uuid not null, "order_line_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "quantity" numeric(18,4) not null default '0', "metadata" jsonb null, primary key ("id"));`);
    this.addSql(`create index "sales_shipment_items_scope_idx" on "sales_shipment_items" ("shipment_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_shipments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "shipment_number" text null, "shipping_method_id" uuid null, "status_entry_id" uuid null, "status" text null, "carrier_name" text null, "tracking_numbers" jsonb null, "shipped_at" timestamptz(6) null, "delivered_at" timestamptz(6) null, "weight_value" numeric(16,4) null, "weight_unit" text null, "declared_value_net" numeric(18,4) null, "declared_value_gross" numeric(18,4) null, "currency_code" text null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "items_snapshot" jsonb null, primary key ("id"));`);
    this.addSql(`create index "sales_shipments_scope_idx" on "sales_shipments" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_shipments_status_idx" on "sales_shipments" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_shipping_methods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "carrier_code" text null, "service_level" text null, "estimated_transit_days" int4 null, "base_rate_net" numeric(16,4) not null default '0', "base_rate_gross" numeric(16,4) not null default '0', "currency_code" text null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "provider_key" text null, primary key ("id"));`);
    this.addSql(`alter table "sales_shipping_methods" add constraint "sales_shipping_methods_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_shipping_methods_scope_idx" on "sales_shipping_methods" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_tax_rates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "rate" numeric(7,4) not null, "country_code" text null, "region_code" text null, "postal_code" text null, "city" text null, "customer_group_id" uuid null, "product_category_id" uuid null, "channel_id" uuid null, "priority" int4 not null default 0, "is_compound" bool not null default false, "metadata" jsonb null, "starts_at" timestamptz(6) null, "ends_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "is_default" bool not null default false, primary key ("id"));`);
    this.addSql(`alter table "sales_tax_rates" add constraint "sales_tax_rates_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_tax_rates_scope_idx" on "sales_tax_rates" ("organization_id", "tenant_id");`);

    this.addSql(`create table "scheduled_jobs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid null, "scope_type" text not null default 'tenant', "name" text not null, "description" text null, "schedule_type" text not null, "schedule_value" text not null, "timezone" text not null default 'UTC', "target_type" text not null, "target_queue" text null, "target_command" text null, "target_payload" jsonb null, "require_feature" text null, "is_enabled" bool not null default true, "last_run_at" timestamptz(6) null, "next_run_at" timestamptz(6) null, "source_type" text not null default 'user', "source_module" text null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), "deleted_at" timestamptz(6) null, "created_by_user_id" uuid null, "updated_by_user_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "scheduled_jobs_next_run_idx" on "scheduled_jobs" ("next_run_at");`);
    this.addSql(`create index "scheduled_jobs_org_tenant_idx" on "scheduled_jobs" ("organization_id", "tenant_id");`);
    this.addSql(`create index "scheduled_jobs_scope_idx" on "scheduled_jobs" ("scope_type", "is_enabled");`);

    this.addSql(`create table "search_tokens" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "field" text not null, "token_hash" text not null, "token" text null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "search_tokens_entity_idx" on "search_tokens" ("entity_type", "entity_id");`);
    this.addSql(`create index "search_tokens_lookup_idx" on "search_tokens" ("entity_type", "field", "token_hash", "tenant_id", "organization_id");`);
    this.addSql(`create index "search_tokens_presence_idx" on "search_tokens" ("entity_type", "tenant_id", "organization_id");`);
    this.addSql(`create index "search_tokens_tenant_token_hash_idx" on "search_tokens" ("tenant_id", "token_hash");`);

    this.addSql(`create table "sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, "last_used_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_unique" unique ("token");`);

    this.addSql(`create table "sidebar_variants" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "locale" text not null, "name" text not null, "settings_json" jsonb null, "is_active" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "sidebar_variants_active_name_unique_idx" on "sidebar_variants" ("user_id", "tenant_id", "name") where deleted_at IS NULL;`);

    this.addSql(`create table "staff_leave_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "member_id" uuid not null, "start_date" timestamptz(6) not null, "end_date" timestamptz(6) not null, "timezone" text not null, "status" text not null default 'pending', "unavailability_reason_entry_id" uuid null, "unavailability_reason_value" text null, "note" text null, "decision_comment" text null, "submitted_by_user_id" uuid null, "decided_by_user_id" uuid null, "decided_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "staff_leave_requests_member_idx" on "staff_leave_requests" ("member_id");`);
    this.addSql(`create index "staff_leave_requests_status_idx" on "staff_leave_requests" ("status", "tenant_id", "organization_id");`);
    this.addSql(`create index "staff_leave_requests_tenant_org_idx" on "staff_leave_requests" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_activities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz(6) null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "member_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "staff_team_member_activities_member_idx" on "staff_team_member_activities" ("member_id");`);
    this.addSql(`create index "staff_team_member_activities_member_occurred_created_idx" on "staff_team_member_activities" ("member_id", "occurred_at", "created_at");`);
    this.addSql(`create index "staff_team_member_activities_tenant_org_idx" on "staff_team_member_activities" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_addresses" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text null, "purpose" text null, "company_name" text null, "address_line1" text not null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "building_number" text null, "flat_number" text null, "latitude" float4 null, "longitude" float4 null, "is_primary" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "member_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "staff_team_member_addresses_member_idx" on "staff_team_member_addresses" ("member_id");`);
    this.addSql(`create index "staff_team_member_addresses_tenant_org_idx" on "staff_team_member_addresses" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "member_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "staff_team_member_comments_member_idx" on "staff_team_member_comments" ("member_id");`);
    this.addSql(`create index "staff_team_member_comments_tenant_org_idx" on "staff_team_member_comments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_job_histories" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "company_name" text null, "description" text null, "start_date" timestamptz(6) not null, "end_date" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "member_id" uuid not null, primary key ("id"));`);
    this.addSql(`create index "staff_team_member_job_histories_member_idx" on "staff_team_member_job_histories" ("member_id");`);
    this.addSql(`create index "staff_team_member_job_histories_member_start_idx" on "staff_team_member_job_histories" ("member_id", "start_date");`);
    this.addSql(`create index "staff_team_member_job_histories_tenant_org_idx" on "staff_team_member_job_histories" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "team_id" uuid null, "display_name" text not null, "description" text null, "user_id" uuid null, "role_ids" jsonb not null default '[]', "tags" jsonb not null default '[]', "availability_rule_set_id" uuid null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "staff_team_members_tenant_org_idx" on "staff_team_members" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_roles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "team_id" uuid null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "staff_team_roles_tenant_org_idx" on "staff_team_roles" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_teams" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "staff_teams_tenant_org_idx" on "staff_teams" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_entries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "staff_member_id" uuid not null, "date" date not null, "duration_minutes" int4 not null default 0, "started_at" timestamptz(6) null, "ended_at" timestamptz(6) null, "notes" text null, "time_project_id" uuid null, "customer_id" uuid null, "deal_id" uuid null, "order_id" uuid null, "source" text not null default 'manual', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "staff_time_entries_member_date_idx" on "staff_time_entries" ("organization_id", "staff_member_id", "date");`);
    this.addSql(`create index "staff_time_entries_project_date_idx" on "staff_time_entries" ("organization_id", "time_project_id", "date");`);
    this.addSql(`create index "staff_time_entries_tenant_org_idx" on "staff_time_entries" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_entry_segments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "time_entry_id" uuid not null, "started_at" timestamptz(6) not null, "ended_at" timestamptz(6) null, "segment_type" text not null default 'work', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "staff_time_entry_segments_entry_idx" on "staff_time_entry_segments" ("time_entry_id");`);
    this.addSql(`create index "staff_time_entry_segments_tenant_org_idx" on "staff_time_entry_segments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_project_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "time_project_id" uuid not null, "staff_member_id" uuid not null, "role" text null, "status" text not null default 'active', "assigned_start_date" date not null, "assigned_end_date" date null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "show_in_grid" bool not null default false, primary key ("id"));`);
    this.addSql(`create index "staff_time_project_members_member_idx" on "staff_time_project_members" ("organization_id", "staff_member_id");`);
    this.addSql(`create index "staff_time_project_members_project_idx" on "staff_time_project_members" ("organization_id", "time_project_id");`);
    this.addSql(`create index "staff_time_project_members_tenant_org_idx" on "staff_time_project_members" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "staff_time_project_members_unique_idx" on "staff_time_project_members" ("organization_id", "tenant_id", "time_project_id", "staff_member_id") where deleted_at IS NULL;`);

    this.addSql(`create table "staff_time_projects" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "customer_id" uuid null, "code" text not null, "description" text null, "project_type" text null, "status" text not null default 'active', "owner_user_id" uuid null, "cost_center" text null, "start_date" date null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "color" varchar(20) null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_projects_code_unique_idx" on "staff_time_projects" ("organization_id", "tenant_id", "code") where deleted_at IS NULL;`);
    this.addSql(`create index "staff_time_projects_tenant_org_idx" on "staff_time_projects" ("tenant_id", "organization_id");`);

    this.addSql(`create table "step_instances" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "step_id" varchar(100) not null, "step_name" varchar(255) not null, "step_type" varchar(50) not null, "status" varchar(20) not null, "input_data" jsonb null, "output_data" jsonb null, "error_data" jsonb null, "entered_at" timestamptz(6) null, "exited_at" timestamptz(6) null, "execution_time_ms" int4 null, "retry_count" int4 not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "branch_instance_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "step_instances_step_id_idx" on "step_instances" ("step_id", "status");`);
    this.addSql(`create index "step_instances_tenant_org_idx" on "step_instances" ("tenant_id", "organization_id");`);
    this.addSql(`create index "step_instances_workflow_instance_idx" on "step_instances" ("workflow_instance_id", "status");`);

    this.addSql(`create table "sync_cursors" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "direction" text not null, "cursor" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create unique index "sync_cursors_integration_id_entity_type_direction__b4d87_index" on "sync_cursors" ("integration_id", "entity_type", "direction", "organization_id", "tenant_id");`);

    this.addSql(`create table "sync_excel_uploads" ("id" uuid not null default gen_random_uuid(), "attachment_id" uuid not null, "filename" text not null, "mime_type" text not null, "file_size" int4 not null, "entity_type" text not null, "delimiter" text null, "encoding" text null, "headers" jsonb not null, "sample_rows" jsonb not null, "total_rows" int4 not null, "status" text not null default 'uploaded', "sync_run_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "sync_excel_uploads_organization_id_tenant_id_status_index" on "sync_excel_uploads" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sync_external_id_mappings" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "internal_entity_type" text not null, "internal_entity_id" uuid not null, "external_id" text not null, "sync_status" text not null default 'not_synced', "last_synced_at" timestamptz(6) null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sync_external_id_mappings_integration_id_external__c088c_index" on "sync_external_id_mappings" ("integration_id", "external_id", "organization_id");`);
    this.addSql(`create index "sync_external_id_mappings_internal_entity_type_int_f9194_index" on "sync_external_id_mappings" ("internal_entity_type", "internal_entity_id", "organization_id");`);

    this.addSql(`create table "sync_mappings" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "mapping" jsonb not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create unique index "sync_mappings_integration_id_entity_type_organizat_edee9_index" on "sync_mappings" ("integration_id", "entity_type", "organization_id", "tenant_id");`);

    this.addSql(`create table "sync_runs" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "direction" text not null, "status" text not null, "cursor" text null, "initial_cursor" text null, "created_count" int4 not null default 0, "updated_count" int4 not null default 0, "skipped_count" int4 not null default 0, "failed_count" int4 not null default 0, "batches_completed" int4 not null default 0, "last_error" text null, "progress_job_id" uuid null, "job_id" text null, "triggered_by" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "parameters" jsonb null, primary key ("id"));`);
    this.addSql(`create index "sync_runs_integration_id_entity_type_status_organi_8b13b_index" on "sync_runs" ("integration_id", "entity_type", "status", "organization_id", "tenant_id");`);

    this.addSql(`create table "sync_schedules" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "direction" text not null, "schedule_type" text not null, "schedule_value" text not null, "timezone" text not null default 'UTC', "full_sync" bool not null default false, "is_enabled" bool not null default true, "scheduled_job_id" uuid null, "last_run_at" timestamptz(6) null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "sync_schedules_integration_id_entity_type_directio_addb9_index" on "sync_schedules" ("integration_id", "entity_type", "direction", "organization_id", "tenant_id");`);

    this.addSql(`create table "tasks_labels" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "color" text not null default '#64748B', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "tasks_labels_scope_idx" on "tasks_labels" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "tasks_labels" add constraint "tasks_labels_scope_name_uq" unique ("tenant_id", "organization_id", "name");`);

    this.addSql(`create table "tasks_milestones" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "name" text not null, "description" text null, "status" text not null default 'planned', "due_date" date null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "tasks_milestones_project_idx" on "tasks_milestones" ("project_id");`);
    this.addSql(`create index "tasks_milestones_scope_idx" on "tasks_milestones" ("tenant_id", "organization_id");`);

    this.addSql(`create table "tasks_project_docs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "parent_id" uuid null, "author_user_id" uuid null, "title" text not null, "body" text not null default '', "body_plaintext" text not null default '', "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "tasks_project_docs_author_idx" on "tasks_project_docs" ("author_user_id");`);
    this.addSql(`create index "tasks_project_docs_parent_idx" on "tasks_project_docs" ("parent_id");`);
    this.addSql(`CREATE INDEX tasks_project_docs_project_idx ON public.tasks_project_docs USING btree (project_id, "position");`);

    this.addSql(`create table "tasks_project_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "user_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "tasks_project_members_project_idx" on "tasks_project_members" ("project_id");`);
    this.addSql(`alter table "tasks_project_members" add constraint "tasks_project_members_uq" unique ("project_id", "user_id");`);
    this.addSql(`create index "tasks_project_members_user_idx" on "tasks_project_members" ("user_id");`);

    this.addSql(`create table "tasks_projects" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "icon" text not null default '📋', "owner_user_id" uuid null, "start_date" date null, "archived_at" timestamptz(6) null, "is_inbox" bool not null default false, "task_seq" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "tasks_projects_owner_idx" on "tasks_projects" ("owner_user_id");`);
    this.addSql(`create index "tasks_projects_scope_archived_idx" on "tasks_projects" ("tenant_id", "organization_id", "archived_at");`);
    this.addSql(`create index "tasks_projects_scope_idx" on "tasks_projects" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "tasks_projects" add constraint "tasks_projects_scope_key_uq" unique ("tenant_id", "organization_id", "key");`);
    this.addSql(`create unique index "tasks_projects_single_inbox_idx" on "tasks_projects" ("tenant_id", "organization_id") where is_inbox AND (deleted_at IS NULL);`);

    this.addSql(`create table "tasks_task_assignees" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "user_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_assignees_task_idx" on "tasks_task_assignees" ("task_id");`);
    this.addSql(`alter table "tasks_task_assignees" add constraint "tasks_task_assignees_uq" unique ("task_id", "user_id");`);
    this.addSql(`create index "tasks_task_assignees_user_idx" on "tasks_task_assignees" ("user_id");`);

    this.addSql(`create table "tasks_task_assignment_targets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "kind" text not null default 'role', "role_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_assignment_targets_role_idx" on "tasks_task_assignment_targets" ("role_id");`);
    this.addSql(`create index "tasks_task_assignment_targets_task_idx" on "tasks_task_assignment_targets" ("task_id");`);
    this.addSql(`alter table "tasks_task_assignment_targets" add constraint "tasks_task_assignment_targets_uq" unique ("task_id", "role_id");`);

    this.addSql(`create table "tasks_task_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "author_user_id" uuid null, "body" text not null, "body_plaintext" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_comments_author_idx" on "tasks_task_comments" ("author_user_id");`);
    this.addSql(`create index "tasks_task_comments_task_idx" on "tasks_task_comments" ("task_id", "created_at");`);

    this.addSql(`create table "tasks_task_labels" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "label_id" uuid not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_labels_label_idx" on "tasks_task_labels" ("label_id");`);
    this.addSql(`create index "tasks_task_labels_task_idx" on "tasks_task_labels" ("task_id");`);
    this.addSql(`alter table "tasks_task_labels" add constraint "tasks_task_labels_uq" unique ("task_id", "label_id");`);

    this.addSql(`create table "tasks_tasks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "milestone_id" uuid null, "parent_task_id" uuid null, "number" int4 not null, "title" text not null, "description" text not null default '', "description_plaintext" text not null default '', "status" text not null default 'backlog', "priority" text not null default 'none', "reviewer_user_id" uuid null, "reporter_user_id" uuid null, "due_date" date null, "due_time" text null, "recurrence_freq" text null, "recurrence_weekday" int4 null, "recurrence_day_of_month" int4 null, "completed_at" timestamptz(6) null, "rank" float8 not null default 0, "archived_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "tasks_tasks_board_idx" on "tasks_tasks" ("project_id", "status", "rank");`);
    this.addSql(`create index "tasks_tasks_due_date_idx" on "tasks_tasks" ("due_date");`);
    this.addSql(`create index "tasks_tasks_parent_idx" on "tasks_tasks" ("parent_task_id");`);
    this.addSql(`create index "tasks_tasks_project_idx" on "tasks_tasks" ("project_id");`);
    this.addSql(`create index "tasks_tasks_project_milestone_idx" on "tasks_tasks" ("project_id", "milestone_id");`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_project_number_uq" unique ("project_id", "number");`);
    this.addSql(`create index "tasks_tasks_reporter_idx" on "tasks_tasks" ("reporter_user_id");`);
    this.addSql(`create index "tasks_tasks_reviewer_idx" on "tasks_tasks" ("reviewer_user_id");`);
    this.addSql(`create index "tasks_tasks_scope_idx" on "tasks_tasks" ("tenant_id", "organization_id");`);
    this.addSql(`create index "tasks_tasks_status_due_idx" on "tasks_tasks" ("status", "due_date");`);

    this.addSql(`create table "tenant_modules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "module_id" text not null, "is_enabled" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "tenant_modules_tenant_idx" on "tenant_modules" ("tenant_id");`);
    this.addSql(`alter table "tenant_modules" add constraint "tenant_modules_tenant_module_uniq" unique ("tenant_id", "module_id");`);

    this.addSql(`create table "tenants" ("id" uuid not null default gen_random_uuid(), "name" text not null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);

    this.addSql(`create table "todos" ("id" uuid not null default gen_random_uuid(), "title" text not null, "tenant_id" uuid null, "organization_id" uuid null, "is_done" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "notes" text null, primary key ("id"));`);

    this.addSql(`create table "upgrade_action_runs" ("id" uuid not null default gen_random_uuid(), "version" text not null, "action_id" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "completed_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "upgrade_action_runs" add constraint "upgrade_action_runs_action_scope_unique" unique ("version", "action_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "upgrade_action_runs_scope_idx" on "upgrade_action_runs" ("organization_id", "tenant_id");`);

    this.addSql(`create table "user_acls" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" bool not null default false, "organizations_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);

    this.addSql(`create table "user_consents" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "consent_type" text not null, "is_granted" bool not null default false, "granted_at" timestamptz(6) null, "withdrawn_at" timestamptz(6) null, "source" text null, "ip_address" text null, "integrity_hash" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`alter table "user_consents" add constraint "user_consents_user_id_tenant_id_consent_type_unique" unique ("user_id", "tenant_id", "consent_type");`);

    this.addSql(`create table "user_devices" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "user_id" uuid not null, "device_id" text not null, "platform" text not null, "client_app_version" text null, "os_version" text null, "push_token" text null, "push_provider" text null, "push_token_updated_at" timestamptz(6) null, "last_seen_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "locale" text null, primary key ("id"));`);
    this.addSql(`create unique index "user_devices_tenant_org_user_device_active_unique" on "user_devices" ("tenant_id", "organization_id", "user_id", "device_id") where deleted_at IS NULL;`);
    this.addSql(`create index "user_devices_tenant_user_idx" on "user_devices" ("tenant_id", "user_id");`);

    this.addSql(`create table "user_modules" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "module_id" text not null, "is_enabled" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "user_modules_tenant_idx" on "user_modules" ("tenant_id");`);
    this.addSql(`alter table "user_modules" add constraint "user_modules_user_module_uniq" unique ("user_id", "module_id");`);

    this.addSql(`create table "user_roles" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "role_id" uuid not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "user_roles_role_id_idx" on "user_roles" ("role_id");`);
    this.addSql(`create index "user_roles_user_id_idx" on "user_roles" ("user_id");`);

    this.addSql(`create table "user_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create unique index "user_sidebar_preferences_active_unique_idx" on "user_sidebar_preferences" ("user_id", "tenant_id", "organization_id") where deleted_at IS NULL;`);

    this.addSql(`create table "user_tasks" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "step_instance_id" uuid not null, "task_name" varchar(255) not null, "description" text null, "status" varchar(20) not null, "form_schema" jsonb null, "form_data" jsonb null, "assigned_to" varchar(255) null, "assigned_to_roles" text[] null, "claimed_by" varchar(255) null, "claimed_at" timestamptz(6) null, "due_date" timestamptz(6) null, "escalated_at" timestamptz(6) null, "escalated_to" varchar(255) null, "completed_by" varchar(255) null, "completed_at" timestamptz(6) null, "comments" text null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "branch_instance_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "user_tasks_status_assigned_idx" on "user_tasks" ("status", "assigned_to");`);
    this.addSql(`create index "user_tasks_status_due_date_idx" on "user_tasks" ("status", "due_date");`);
    this.addSql(`create index "user_tasks_tenant_org_idx" on "user_tasks" ("tenant_id", "organization_id");`);
    this.addSql(`create index "user_tasks_workflow_instance_idx" on "user_tasks" ("workflow_instance_id");`);

    this.addSql(`create table "users" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "email" text not null, "name" text null, "password_hash" text null, "is_confirmed" bool not null default true, "last_login_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "email_hash" text null, "updated_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "users_email_hash_idx" on "users" ("email_hash");`);
    this.addSql(`create unique index "users_tenant_email_hash_uniq" on "users" ("tenant_id", "email_hash") where (deleted_at IS NULL) AND (email_hash IS NOT NULL);`);

    this.addSql(`create table "warranty_claim_events" ("id" uuid not null default gen_random_uuid(), "claim_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "visibility" text not null default 'internal', "body" text null, "payload" jsonb null, "actor_user_id" uuid null, "actor_customer_id" uuid null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_events_claim_created_idx" on "warranty_claim_events" ("claim_id", "created_at");`);

    this.addSql(`create table "warranty_claim_lines" ("id" uuid not null default gen_random_uuid(), "claim_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_no" int4 not null, "product_id" uuid null, "variant_id" uuid null, "sku" text null, "product_name" text null, "order_line_id" uuid null, "serial_number" text null, "lot_number" text null, "purchase_date" timestamptz(6) null, "warranty_months" int4 null, "warranty_expires_at" timestamptz(6) null, "warranty_status" text not null default 'unknown', "fault_code" text null, "fault_description" text null, "qty_claimed" numeric(18,4) not null default '1', "qty_approved" numeric(18,4) null, "qty_received" numeric(18,4) null, "condition_on_receipt" text null, "inspection_notes" text null, "disposition" text null, "line_status" text not null default 'pending', "credit_amount" numeric(18,4) null, "restocking_fee" numeric(18,4) null, "core_charge_amount" numeric(18,4) null, "core_credit_amount" numeric(18,4) null, "vendor_claim_line_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "condition_grade" text null, "quarantine_status" text not null default 'none', "assessment_payload" jsonb null, "vendor_name" text null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_lines_claim_idx" on "warranty_claim_lines" ("claim_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "warranty_claim_lines_order_line_idx" on "warranty_claim_lines" ("order_line_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "warranty_claim_lines_product_idx" on "warranty_claim_lines" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "warranty_claim_lines_serial_idx" on "warranty_claim_lines" ("tenant_id", "organization_id", "serial_number");`);

    this.addSql(`create table "warranty_claim_registrations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "serial_number" text null, "product_id" uuid null, "variant_id" uuid null, "sku" text null, "product_name" text null, "customer_id" uuid null, "order_id" uuid null, "purchase_date" timestamptz(6) null, "warranty_months" int4 null, "warranty_expires_at" timestamptz(6) null, "coverage_type" text null, "source" text null, "proof_attachment_id" uuid null, "notes" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_registrations_customer_idx" on "warranty_claim_registrations" ("tenant_id", "organization_id", "customer_id");`);
    this.addSql(`create index "warranty_claim_registrations_serial_idx" on "warranty_claim_registrations" ("tenant_id", "organization_id", "serial_number");`);

    this.addSql(`create table "warranty_claim_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_type" text not null, "next_number" int4 not null default 1, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "warranty_claim_sequences" add constraint "warranty_claim_sequences_type_unique" unique ("tenant_id", "organization_id", "claim_type");`);

    this.addSql(`create table "warranty_claim_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sla_hours" int4 not null default 48, "sla_pause_on_info_requested" bool not null default true, "sla_at_risk_threshold_pct" int4 not null default 75, "auto_approve_enabled" bool not null default false, "auto_approve_max_amount" numeric(18,4) null, "auto_approve_currency_code" text null, "auto_approve_require_in_warranty" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "default_warranty_months" int4 null, "business_hours" jsonb null, "escalation_tiers" jsonb null, "adjudication_use_rules" bool not null default false, "quarantine_grades" jsonb null, "return_label_provider" text null, "return_window_days" int4 null, primary key ("id"));`);
    this.addSql(`alter table "warranty_claim_settings" add constraint "warranty_claim_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "warranty_claim_sla_signals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_id" uuid not null, "event_id" text not null, "cycle_key" text not null, "payload" jsonb not null, "lease_token" uuid null, "lease_expires_at" timestamptz(6) null, "published_at" timestamptz(6) null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "warranty_claim_sla_signals" add constraint "warranty_claim_sla_signals_claim_event_cycle_unique" unique ("tenant_id", "organization_id", "claim_id", "event_id", "cycle_key");`);
    this.addSql(`create index "warranty_claim_sla_signals_pending_scope_idx" on "warranty_claim_sla_signals" ("tenant_id", "organization_id", "published_at", "created_at");`);

    this.addSql(`create table "warranty_claim_troubleshooting_guides" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_type" text null, "reason_code" text null, "title" text not null, "steps" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_troubleshooting_guides_lookup_idx" on "warranty_claim_troubleshooting_guides" ("tenant_id", "organization_id", "claim_type", "reason_code");`);

    this.addSql(`create table "warranty_claim_vendor_policies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "vendor_name" text not null, "vendor_ref" text null, "coverage_months" int4 null, "claimable_reason_codes" jsonb null, "recovery_rate_pct" numeric(5,2) null, "contact_email" text null, "auto_generate_recovery" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_vendor_policies_vendor_idx" on "warranty_claim_vendor_policies" ("tenant_id", "organization_id", "vendor_name");`);

    this.addSql(`create table "warranty_claims" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_number" text not null, "claim_type" text not null, "status" text not null default 'draft', "channel" text not null default 'staff', "priority" text not null default 'normal', "customer_id" uuid null, "customer_name" text null, "vendor_name" text null, "vendor_ref" text null, "order_id" uuid null, "sales_return_id" uuid null, "replacement_order_id" uuid null, "source_claim_id" uuid null, "advance_replacement" bool not null default false, "advance_shipped_at" timestamptz(6) null, "reason_code" text null, "rejection_reason_code" text null, "resolution_summary" text null, "notes" text null, "currency_code" text null, "total_claimed_amount" numeric(18,4) null, "total_approved_amount" numeric(18,4) null, "total_recovered_amount" numeric(18,4) null, "sla_due_at" timestamptz(6) null, "submitted_at" timestamptz(6) null, "resolved_at" timestamptz(6) null, "closed_at" timestamptz(6) null, "assignee_user_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "sla_paused_at" timestamptz(6) null, "external_ref" text null, "contact_email" text null, "return_label_url" text null, "return_tracking_number" text null, "return_carrier" text null, "escalation_level" int4 not null default 0, "escalated_at" timestamptz(6) null, "intake_message_ref" text null, "entitlement_source" text null, "order_number" text null, "awaiting_staff_reply" bool not null default false, "sla_at_risk_notified_at" timestamptz(6) null, "sla_breached_notified_at" timestamptz(6) null, "credit_memo_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "warranty_claims_customer_idx" on "warranty_claims" ("customer_id", "organization_id", "tenant_id");`);
    this.addSql(`create unique index "warranty_claims_external_ref_unique" on "warranty_claims" ("tenant_id", "organization_id", "external_ref") where (external_ref IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create unique index "warranty_claims_intake_message_ref_unique" on "warranty_claims" ("tenant_id", "organization_id", "intake_message_ref") where (intake_message_ref IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`alter table "warranty_claims" add constraint "warranty_claims_number_unique" unique ("tenant_id", "organization_id", "claim_number");`);
    this.addSql(`create index "warranty_claims_order_idx" on "warranty_claims" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "warranty_claims_return_tracking_idx" on "warranty_claims" ("tenant_id", "organization_id", "return_tracking_number") where (return_tracking_number IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "warranty_claims_status_idx" on "warranty_claims" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "webhook_deliveries" ("id" uuid not null default gen_random_uuid(), "webhook_id" uuid not null, "event_type" text not null, "message_id" text not null, "payload" jsonb not null, "status" text not null default 'pending', "response_status" int4 null, "response_body" text null, "response_headers" jsonb null, "error_message" text null, "attempt_number" int4 not null default 0, "max_attempts" int4 not null default 10, "next_retry_at" timestamptz(6) null, "duration_ms" int4 null, "target_url" text not null, "enqueued_at" timestamptz(6) not null, "last_attempt_at" timestamptz(6) null, "delivered_at" timestamptz(6) null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "webhook_deliveries_event_type_organization_id_index" on "webhook_deliveries" ("event_type", "organization_id");`);
    this.addSql(`create index "webhook_deliveries_organization_id_tenant_id_created_at_index" on "webhook_deliveries" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index "webhook_deliveries_webhook_id_created_at_index" on "webhook_deliveries" ("webhook_id", "created_at");`);
    this.addSql(`create index "webhook_deliveries_webhook_id_status_index" on "webhook_deliveries" ("webhook_id", "status");`);

    this.addSql(`create table "webhook_inbound_configs" ("id" uuid not null default gen_random_uuid(), "source_key" text not null, "is_active" bool not null default true, "integration_id" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "webhook_inbound_configs_source_key_is_active_index" on "webhook_inbound_configs" ("source_key", "is_active");`);
    this.addSql(`alter table "webhook_inbound_configs" add constraint "webhook_inbound_configs_source_scope_unique" unique ("source_key", "organization_id", "tenant_id");`);

    this.addSql(`create table "webhook_inbound_receipts" ("id" uuid not null default gen_random_uuid(), "endpoint_id" text not null, "message_id" text not null, "provider_key" text not null, "event_type" text null, "organization_id" uuid null, "tenant_id" uuid null, "created_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`alter table "webhook_inbound_receipts" add constraint "webhook_inbound_receipts_endpoint_message_unique" unique ("endpoint_id", "message_id");`);
    this.addSql(`create index "webhook_inbound_receipts_provider_key_created_at_index" on "webhook_inbound_receipts" ("provider_key", "created_at");`);

    this.addSql(`create table "webhook_ingestions" ("id" uuid not null default gen_random_uuid(), "source_key" text not null, "event_type" text not null, "external_message_id" text null, "payload" jsonb not null, "headers" jsonb null, "status" text not null default 'received', "error_message" text null, "processed_at" timestamptz(6) null, "handler_count" int4 not null default 0, "handler_results" jsonb null, "duration_ms" int4 null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "webhook_ingestions_external_message_id_index" on "webhook_ingestions" ("external_message_id");`);
    this.addSql(`create index "webhook_ingestions_organization_id_tenant_id_created_at_index" on "webhook_ingestions" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index "webhook_ingestions_source_key_status_created_at_index" on "webhook_ingestions" ("source_key", "status", "created_at");`);

    this.addSql(`create table "webhooks" ("id" uuid not null default gen_random_uuid(), "name" text not null, "description" text null, "url" text not null, "secret" text not null, "previous_secret" text null, "previous_secret_set_at" timestamptz(6) null, "subscribed_events" jsonb not null, "http_method" text not null default 'POST', "custom_headers" jsonb null, "is_active" bool not null default true, "delivery_strategy" text not null default 'http', "strategy_config" jsonb null, "max_retries" int4 not null default 10, "timeout_ms" int4 not null default 15000, "rate_limit_per_minute" int4 not null default 0, "consecutive_failures" int4 not null default 0, "auto_disable_threshold" int4 not null default 100, "last_success_at" timestamptz(6) null, "last_failure_at" timestamptz(6) null, "integration_id" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "webhooks_organization_id_tenant_id_deleted_at_index" on "webhooks" ("organization_id", "tenant_id", "deleted_at");`);
    this.addSql(`create index "webhooks_organization_id_tenant_id_is_active_index" on "webhooks" ("organization_id", "tenant_id", "is_active");`);

    this.addSql(`create table "wms_inventory_balances" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "warehouse_id" uuid not null, "location_id" uuid not null, "catalog_variant_id" uuid not null, "lot_id" uuid null, "serial_number" text null, "quantity_on_hand" numeric(16,4) not null default '0', "quantity_reserved" numeric(16,4) not null default '0', "quantity_allocated" numeric(16,4) not null default '0', "quantity_available" numeric(16,4) generated always as ((quantity_on_hand - quantity_reserved) - quantity_allocated) stored not null, primary key ("id"));`);
    this.addSql(`create index "wms_inventory_balances_org_location_variant_idx" on "wms_inventory_balances" ("organization_id", "location_id", "catalog_variant_id");`);
    this.addSql(`create index "wms_inventory_balances_org_lot_idx" on "wms_inventory_balances" ("organization_id", "lot_id") where (lot_id IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "wms_inventory_balances_org_tenant_idx" on "wms_inventory_balances" ("organization_id", "tenant_id");`);
    this.addSql(`create index "wms_inventory_balances_org_warehouse_variant_idx" on "wms_inventory_balances" ("organization_id", "warehouse_id", "catalog_variant_id");`);
    this.addSql(`create unique index "wms_inventory_balances_serial_unique_idx" on "wms_inventory_balances" ("organization_id", "warehouse_id", "location_id", "catalog_variant_id", "serial_number") where (serial_number IS NOT NULL) AND (deleted_at IS NULL);`);

    this.addSql(`create table "wms_inventory_lots" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "catalog_variant_id" uuid not null, "sku" text not null, "lot_number" text not null, "batch_number" text null, "manufactured_at" timestamptz(6) null, "best_before_at" timestamptz(6) null, "expires_at" timestamptz(6) null, "status" text not null default 'available', primary key ("id"));`);
    this.addSql(`create index "wms_inventory_lots_org_tenant_idx" on "wms_inventory_lots" ("organization_id", "tenant_id");`);
    this.addSql(`create index "wms_inventory_lots_variant_idx" on "wms_inventory_lots" ("catalog_variant_id");`);
    this.addSql(`create unique index "wms_inventory_lots_variant_lot_unique_idx" on "wms_inventory_lots" ("organization_id", "catalog_variant_id", "lot_number") where deleted_at IS NULL;`);

    this.addSql(`create table "wms_inventory_movements" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "warehouse_id" uuid not null, "location_from_id" uuid null, "location_to_id" uuid null, "catalog_variant_id" uuid not null, "lot_id" uuid null, "serial_number" text null, "quantity" numeric(16,4) not null, "type" text not null, "reference_type" text not null, "reference_id" uuid not null, "performed_by" uuid not null, "performed_at" timestamptz(6) not null, "received_at" timestamptz(6) not null, "reason" text null, "idempotency_key" text null, "reason_code" text null, primary key ("id"));`);
    this.addSql(`create unique index "wms_inventory_movements_idempotency_unique_idx" on "wms_inventory_movements" ("organization_id", "idempotency_key") where (idempotency_key IS NOT NULL) AND (deleted_at IS NULL);`);
    this.addSql(`create index "wms_inventory_movements_org_tenant_idx" on "wms_inventory_movements" ("organization_id", "tenant_id");`);
    this.addSql(`create index "wms_inventory_movements_reference_idx" on "wms_inventory_movements" ("organization_id", "reference_type", "reference_id");`);
    this.addSql(`create index "wms_inventory_movements_variant_received_at_idx" on "wms_inventory_movements" ("organization_id", "catalog_variant_id", "received_at" DESC) where deleted_at IS NULL;`);
    this.addSql(`create index "wms_inventory_movements_warehouse_performed_at_idx" on "wms_inventory_movements" ("organization_id", "warehouse_id", "performed_at" DESC) where deleted_at IS NULL;`);

    this.addSql(`create table "wms_inventory_reservations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "warehouse_id" uuid not null, "catalog_variant_id" uuid not null, "lot_id" uuid null, "serial_number" text null, "quantity" numeric(16,4) not null, "source_type" text not null, "source_id" uuid not null, "expires_at" timestamptz(6) null, "status" text not null default 'active', "idempotency_key" text null, primary key ("id"));`);
    this.addSql(`create unique index "wms_inventory_reservations_idempotency_unique_idx" on "wms_inventory_reservations" ("organization_id", "idempotency_key") where (idempotency_key IS NOT NULL) AND (deleted_at IS NULL) AND (status = 'active'::text);`);
    this.addSql(`create index "wms_inventory_reservations_org_tenant_idx" on "wms_inventory_reservations" ("organization_id", "tenant_id");`);
    this.addSql(`create index "wms_inventory_reservations_source_idx" on "wms_inventory_reservations" ("organization_id", "source_type", "source_id");`);
    this.addSql(`create index "wms_inventory_reservations_status_idx" on "wms_inventory_reservations" ("organization_id", "warehouse_id", "catalog_variant_id", "status");`);

    this.addSql(`create table "wms_product_inventory_profiles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "catalog_product_id" uuid not null, "catalog_variant_id" uuid null, "default_uom" text not null, "track_lot" bool not null default false, "track_serial" bool not null default false, "track_expiration" bool not null default false, "default_strategy" text not null, "reorder_point" numeric(16,4) not null default '0', "safety_stock" numeric(16,4) not null default '0', primary key ("id"));`);
    this.addSql(`create index "wms_inventory_profiles_org_tenant_idx" on "wms_product_inventory_profiles" ("organization_id", "tenant_id");`);
    this.addSql(`create unique index "wms_inventory_profiles_product_unique_idx" on "wms_product_inventory_profiles" ("organization_id", "catalog_product_id") where (deleted_at IS NULL) AND (catalog_variant_id IS NULL);`);
    this.addSql(`create unique index "wms_inventory_profiles_variant_unique_idx" on "wms_product_inventory_profiles" ("organization_id", "catalog_variant_id") where (deleted_at IS NULL) AND (catalog_variant_id IS NOT NULL);`);

    this.addSql(`create table "wms_sales_order_warehouse_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sales_order_id" uuid not null, "warehouse_id" uuid not null, "assigned_by" uuid null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), "deleted_at" timestamptz(6) null, constraint "wms_sowa_pkey" primary key ("id"));`);
    this.addSql(`create unique index "wms_sowa_org_order_unique_idx" on "wms_sales_order_warehouse_assignments" ("organization_id", "sales_order_id") where deleted_at IS NULL;`);
    this.addSql(`create index "wms_sowa_org_tenant_idx" on "wms_sales_order_warehouse_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`create index "wms_sowa_warehouse_idx" on "wms_sales_order_warehouse_assignments" ("warehouse_id");`);

    this.addSql(`create table "wms_warehouse_locations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "warehouse_id" uuid not null, "code" text not null, "type" text not null, "parent_id" uuid null, "is_active" bool not null default true, "capacity_units" numeric(16,4) null, "capacity_weight" numeric(16,4) null, "constraints" jsonb null, primary key ("id"));`);
    this.addSql(`create index "wms_warehouse_locations_org_tenant_idx" on "wms_warehouse_locations" ("organization_id", "tenant_id");`);
    this.addSql(`create index "wms_warehouse_locations_parent_idx" on "wms_warehouse_locations" ("parent_id");`);
    this.addSql(`create unique index "wms_warehouse_locations_warehouse_code_unique_idx" on "wms_warehouse_locations" ("warehouse_id", "code") where deleted_at IS NULL;`);
    this.addSql(`create index "wms_warehouse_locations_warehouse_idx" on "wms_warehouse_locations" ("warehouse_id");`);

    this.addSql(`create table "wms_warehouse_zones" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "warehouse_id" uuid not null, "code" text not null, "name" text not null, "priority" int4 not null default 0, primary key ("id"));`);
    this.addSql(`create index "wms_warehouse_zones_org_tenant_idx" on "wms_warehouse_zones" ("organization_id", "tenant_id");`);
    this.addSql(`create unique index "wms_warehouse_zones_warehouse_code_unique_idx" on "wms_warehouse_zones" ("warehouse_id", "code") where deleted_at IS NULL;`);
    this.addSql(`create index "wms_warehouse_zones_warehouse_idx" on "wms_warehouse_zones" ("warehouse_id");`);

    this.addSql(`create table "wms_warehouses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "name" text not null, "code" text not null, "is_active" bool not null default true, "address_line1" text null, "city" text null, "postal_code" text null, "country" text null, "timezone" text null, "is_primary" bool not null default false, primary key ("id"));`);
    this.addSql(`create unique index "wms_warehouses_org_code_unique_idx" on "wms_warehouses" ("organization_id", "code") where deleted_at IS NULL;`);
    this.addSql(`create unique index "wms_warehouses_org_primary_unique_idx" on "wms_warehouses" ("organization_id") where (deleted_at IS NULL) AND (is_primary = true);`);
    this.addSql(`create index "wms_warehouses_org_tenant_idx" on "wms_warehouses" ("organization_id", "tenant_id");`);

    this.addSql(`create table "workflow_branch_instances" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "fork_step_id" varchar(100) not null, "join_step_id" varchar(100) not null, "branch_key" varchar(100) not null, "parent_branch_id" uuid null, "current_step_id" varchar(100) not null, "status" varchar(30) not null, "context_namespace" jsonb not null, "pending_transition" jsonb null, "error_message" text null, "error_details" jsonb null, "started_at" timestamptz(6) null, "completed_at" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, primary key ("id"));`);
    this.addSql(`create index "workflow_branch_instances_instance_fork_idx" on "workflow_branch_instances" ("workflow_instance_id", "fork_step_id");`);
    this.addSql(`create index "workflow_branch_instances_instance_status_idx" on "workflow_branch_instances" ("workflow_instance_id", "status");`);
    this.addSql(`create index "workflow_branch_instances_tenant_org_idx" on "workflow_branch_instances" ("tenant_id", "organization_id");`);

    this.addSql(`create table "workflow_definitions" ("id" uuid not null default gen_random_uuid(), "workflow_id" varchar(100) not null, "workflow_name" varchar(255) not null, "description" text null, "version" int4 not null default 1, "definition" jsonb not null, "metadata" jsonb null, "enabled" bool not null default true, "effective_from" timestamptz(6) null, "effective_to" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(255) null, "updated_by" varchar(255) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "code_workflow_id" varchar(100) null, primary key ("id"));`);
    this.addSql(`create index "workflow_definitions_enabled_idx" on "workflow_definitions" ("enabled");`);
    this.addSql(`create index "workflow_definitions_tenant_org_idx" on "workflow_definitions" ("tenant_id", "organization_id");`);
    this.addSql(`create index "workflow_definitions_workflow_id_idx" on "workflow_definitions" ("workflow_id");`);
    this.addSql(`alter table "workflow_definitions" add constraint "workflow_definitions_workflow_id_tenant_id_unique" unique ("workflow_id", "tenant_id");`);

    this.addSql(`create table "workflow_event_triggers" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "description" text null, "workflow_definition_id" uuid not null, "event_pattern" varchar(255) not null, "config" jsonb null, "enabled" bool not null default true, "priority" int4 not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(255) null, "updated_by" varchar(255) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, primary key ("id"));`);
    this.addSql(`create index "workflow_event_triggers_definition_idx" on "workflow_event_triggers" ("workflow_definition_id");`);
    this.addSql(`create index "workflow_event_triggers_enabled_priority_idx" on "workflow_event_triggers" ("enabled", "priority");`);
    this.addSql(`create index "workflow_event_triggers_event_pattern_idx" on "workflow_event_triggers" ("event_pattern", "enabled");`);
    this.addSql(`create index "workflow_event_triggers_tenant_org_idx" on "workflow_event_triggers" ("tenant_id", "organization_id");`);

    this.addSql(`create table "workflow_events" ("id" bigserial primary key, "workflow_instance_id" uuid not null, "step_instance_id" uuid null, "event_type" varchar(50) not null, "event_data" jsonb not null, "occurred_at" timestamptz(6) not null, "user_id" varchar(255) null, "tenant_id" uuid not null, "organization_id" uuid not null, "branch_instance_id" uuid null);`);
    this.addSql(`create index "workflow_events_event_type_idx" on "workflow_events" ("event_type", "occurred_at");`);
    this.addSql(`create index "workflow_events_instance_occurred_idx" on "workflow_events" ("workflow_instance_id", "occurred_at");`);
    this.addSql(`create index "workflow_events_tenant_org_idx" on "workflow_events" ("tenant_id", "organization_id");`);

    this.addSql(`create table "workflow_instances" ("id" uuid not null default gen_random_uuid(), "definition_id" uuid not null, "workflow_id" varchar(100) not null, "version" int4 not null, "status" varchar(30) not null, "current_step_id" varchar(100) not null, "context" jsonb not null, "correlation_key" varchar(255) null, "metadata" jsonb null, "started_at" timestamptz(6) not null, "completed_at" timestamptz(6) null, "paused_at" timestamptz(6) null, "cancelled_at" timestamptz(6) null, "error_message" text null, "error_details" jsonb null, "retry_count" int4 not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "pending_transition" jsonb null, "active_fork_step_id" varchar(100) null, primary key ("id"));`);
    this.addSql(`create index "workflow_instances_correlation_key_idx" on "workflow_instances" ("correlation_key");`);
    this.addSql(`create index "workflow_instances_current_step_idx" on "workflow_instances" ("current_step_id", "status");`);
    this.addSql(`create index "workflow_instances_definition_status_idx" on "workflow_instances" ("definition_id", "status");`);
    this.addSql(`create index "workflow_instances_status_tenant_idx" on "workflow_instances" ("status", "tenant_id");`);
    this.addSql(`create index "workflow_instances_tenant_org_idx" on "workflow_instances" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_category_id_foreign" foreign key ("category_id") references "catalog_product_categories" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_options" add constraint "catalog_product_options_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_child_product_id_foreign" foreign key ("child_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_parent_product_id_foreign" foreign key ("parent_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "catalog_product_tags" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_unit_conversions" add constraint "catalog_product_unit_conversions_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_variant_option_values" add constraint "catalog_product_variant_option_values_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_offer_id_foreign" foreign key ("offer_id") references "catalog_product_offers" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_price_kind_id_foreign" foreign key ("price_kind_id") references "catalog_price_kinds" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_child_variant_id_foreign" foreign key ("child_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_parent_variant_id_foreign" foreign key ("parent_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "catalog_products" add constraint "catalog_products_option_schema_id_foreign" foreign key ("option_schema_id") references "catalog_product_option_schemas" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "customer_activities" add constraint "customer_activities_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "customer_activities" add constraint "customer_activities_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_addresses" add constraint "customer_addresses_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_comments" add constraint "customer_comments_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "customer_comments" add constraint "customer_comments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_companies" add constraint "customer_companies_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_company_billing" add constraint "customer_company_billing_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_deal_stage_transitions" add constraint "customer_deal_stage_transitions_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_interactions" add constraint "customer_interactions_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_label_id_foreign" foreign key ("label_id") references "customer_labels" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_people" add constraint "customer_people_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "customer_people" add constraint "customer_people_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_role_acls" add constraint "customer_role_acls_role_id_foreign" foreign key ("role_id") references "customer_roles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "customer_tags" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_todo_links" add constraint "customer_todo_links_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_user_acls" add constraint "customer_user_acls_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_user_email_verifications" add constraint "customer_user_email_verifications_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_user_password_resets" add constraint "customer_user_password_resets_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_user_roles" add constraint "customer_user_roles_role_id_foreign" foreign key ("role_id") references "customer_roles" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_user_roles" add constraint "customer_user_roles_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_user_sessions" add constraint "customer_user_sessions_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "dictionary_entries" add constraint "dictionary_entries_dictionary_id_foreign" foreign key ("dictionary_id") references "dictionaries" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "domain_mappings" add constraint "domain_mappings_replaces_domain_id_foreign" foreign key ("replaces_domain_id") references "domain_mappings" ("id") on update no action on delete set null;`);
    this.addSql(`alter table "domain_mappings" add constraint "domain_mappings_hostname_normalized_chk" check ((hostname = lower(hostname)) AND (hostname !~~ '%.'::text));`);

    this.addSql(`alter table "feature_toggle_audit_logs" add constraint "feature_toggle_audit_logs_toggle_id_foreign" foreign key ("toggle_id") references "feature_toggles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_id_foreign" foreign key ("toggle_id") references "feature_toggles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "message_reactions" add constraint "message_reactions_exactly_one_actor_chk" check ((reacted_by_user_id IS NULL) <> (reacted_by_external_id IS NULL));`);

    this.addSql(`alter table "organizations" add constraint "organizations_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "password_resets" add constraint "password_resets_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "planner_availability_rules" add constraint "planner_availability_rules_kind_check" check ("kind" in ('availability', 'unavailability'));`);
    this.addSql(`alter table "planner_availability_rules" add constraint "planner_availability_rules_subject_type_check" check ("subject_type" in ('member', 'resource', 'ruleset'));`);

    this.addSql(`alter table "resources_resource_activities" add constraint "resources_resource_activities_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "resources_resource_comments" add constraint "resources_resource_comments_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "resources_resource_tags" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "role_acls" add constraint "role_acls_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "rule_execution_logs" add constraint "rule_execution_logs_rule_id_foreign" foreign key ("rule_id") references "business_rules" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_id_foreign" foreign key ("rule_id") references "business_rules" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_set_id_foreign" foreign key ("rule_set_id") references "rule_sets" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_credit_memo_lines" add constraint "sales_credit_memo_lines_credit_memo_id_foreign" foreign key ("credit_memo_id") references "sales_credit_memos" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_credit_memo_lines" add constraint "sales_credit_memo_lines_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_credit_memos" add constraint "sales_credit_memos_invoice_id_foreign" foreign key ("invoice_id") references "sales_invoices" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_credit_memos" add constraint "sales_credit_memos_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "sales_document_tags" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_invoice_lines" add constraint "sales_invoice_lines_invoice_id_foreign" foreign key ("invoice_id") references "sales_invoices" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_invoice_lines" add constraint "sales_invoice_lines_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_invoices" add constraint "sales_invoices_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_notes" add constraint "sales_notes_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_notes" add constraint "sales_notes_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_order_adjustments" add constraint "sales_order_adjustments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_order_adjustments" add constraint "sales_order_adjustments_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_order_lines" add constraint "sales_order_lines_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_orders" add constraint "sales_orders_channel_ref_id_foreign" foreign key ("channel_ref_id") references "sales_channels" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_delivery_window_ref_id_foreign" foreign key ("delivery_window_ref_id") references "sales_delivery_windows" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_payment_method_ref_id_foreign" foreign key ("payment_method_ref_id") references "sales_payment_methods" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_shipping_method_ref_id_foreign" foreign key ("shipping_method_ref_id") references "sales_shipping_methods" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_payment_allocations" add constraint "sales_payment_allocations_invoice_id_foreign" foreign key ("invoice_id") references "sales_invoices" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_payment_allocations" add constraint "sales_payment_allocations_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_payment_allocations" add constraint "sales_payment_allocations_payment_id_foreign" foreign key ("payment_id") references "sales_payments" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_payments" add constraint "sales_payments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_payments" add constraint "sales_payments_payment_method_id_foreign" foreign key ("payment_method_id") references "sales_payment_methods" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_quote_adjustments" add constraint "sales_quote_adjustments_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_quote_adjustments" add constraint "sales_quote_adjustments_quote_line_id_foreign" foreign key ("quote_line_id") references "sales_quote_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_quote_lines" add constraint "sales_quote_lines_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_channel_ref_id_foreign" foreign key ("channel_ref_id") references "sales_channels" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_delivery_window_ref_id_foreign" foreign key ("delivery_window_ref_id") references "sales_delivery_windows" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_payment_method_ref_id_foreign" foreign key ("payment_method_ref_id") references "sales_payment_methods" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_shipping_method_ref_id_foreign" foreign key ("shipping_method_ref_id") references "sales_shipping_methods" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_return_lines" add constraint "sales_return_lines_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_return_lines" add constraint "sales_return_lines_return_id_foreign" foreign key ("return_id") references "sales_returns" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_returns" add constraint "sales_returns_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_shipment_items" add constraint "sales_shipment_items_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_shipment_items" add constraint "sales_shipment_items_shipment_id_foreign" foreign key ("shipment_id") references "sales_shipments" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_shipments" add constraint "sales_shipments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sessions" add constraint "sessions_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sidebar_variants" add constraint "sidebar_variants_user_id_foreign" foreign key ("user_id") references "users" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "staff_leave_requests" add constraint "staff_leave_requests_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "staff_leave_requests" add constraint "staff_leave_requests_status_check" check ("status" in ('pending', 'approved', 'rejected'));`);

    this.addSql(`alter table "staff_team_member_activities" add constraint "staff_team_member_activities_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_team_member_addresses" add constraint "staff_team_member_addresses_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_team_member_comments" add constraint "staff_team_member_comments_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_team_member_job_histories" add constraint "staff_team_member_job_histories_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_time_entries" add constraint "staff_time_entries_source_check" check ("source" in ('manual', 'timer', 'kiosk', 'mobile'));`);

    this.addSql(`alter table "staff_time_entry_segments" add constraint "staff_time_entry_segments_segment_type_check" check ("segment_type" in ('work', 'break'));`);

    this.addSql(`alter table "staff_time_project_members" add constraint "staff_time_project_members_status_check" check ("status" in ('active', 'inactive'));`);

    this.addSql(`alter table "staff_time_projects" add constraint "staff_time_projects_status_check" check ("status" in ('active', 'on_hold', 'completed'));`);

    this.addSql(`alter table "tasks_milestones" add constraint "tasks_milestones_status_check" check ("status" in ('planned', 'active', 'completed'));`);

    this.addSql(`alter table "tasks_task_assignment_targets" add constraint "tasks_task_assignment_targets_kind_check" check ("kind" in ('role'));`);

    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_due_time_check" check ((due_time IS NULL) OR (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]\$'::text));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_due_time_needs_date_check" check ((due_time IS NULL) OR (due_date IS NOT NULL));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_parent_not_self_check" check ((parent_task_id IS NULL) OR (parent_task_id <> id));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_priority_check" check ("priority" in ('none', 'low', 'medium', 'high', 'urgent'));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_recurrence_day_of_month_check" check ((recurrence_day_of_month IS NULL) OR ((recurrence_day_of_month >= 1) AND (recurrence_day_of_month <= 31)));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_recurrence_freq_check" check ("recurrence_freq" in ('daily', 'weekdays', 'weekly', 'monthly'));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_recurrence_weekday_check" check ((recurrence_weekday IS NULL) OR ((recurrence_weekday >= 0) AND (recurrence_weekday <= 6)));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_status_check" check ("status" in ('backlog', 'pending', 'in_progress', 'blocked', 'review', 'done', 'cancelled'));`);

    this.addSql(`alter table "tenant_modules" add constraint "tenant_modules_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "user_acls" add constraint "user_acls_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "user_modules" add constraint "user_modules_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "user_roles" add constraint "user_roles_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "user_roles" add constraint "user_roles_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "warranty_claim_events" add constraint "warranty_claim_events_claim_id_foreign" foreign key ("claim_id") references "warranty_claims" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "warranty_claim_lines" add constraint "warranty_claim_lines_claim_id_foreign" foreign key ("claim_id") references "warranty_claims" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "wms_inventory_balances" add constraint "wms_inventory_balances_location_id_foreign" foreign key ("location_id") references "wms_warehouse_locations" ("id") on update no action on delete no action;`);
    this.addSql(`alter table "wms_inventory_balances" add constraint "wms_inventory_balances_lot_id_foreign" foreign key ("lot_id") references "wms_inventory_lots" ("id") on update no action on delete set null;`);
    this.addSql(`alter table "wms_inventory_balances" add constraint "wms_inventory_balances_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_location_from_id_foreign" foreign key ("location_from_id") references "wms_warehouse_locations" ("id") on update no action on delete set null;`);
    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_location_to_id_foreign" foreign key ("location_to_id") references "wms_warehouse_locations" ("id") on update no action on delete set null;`);
    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_lot_id_foreign" foreign key ("lot_id") references "wms_inventory_lots" ("id") on update no action on delete set null;`);
    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "wms_inventory_reservations" add constraint "wms_inventory_reservations_lot_id_foreign" foreign key ("lot_id") references "wms_inventory_lots" ("id") on update no action on delete set null;`);
    this.addSql(`alter table "wms_inventory_reservations" add constraint "wms_inventory_reservations_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "wms_warehouse_locations" add constraint "wms_warehouse_locations_parent_id_foreign" foreign key ("parent_id") references "wms_warehouse_locations" ("id") on update no action on delete set null;`);
    this.addSql(`alter table "wms_warehouse_locations" add constraint "wms_warehouse_locations_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id") on update no action on delete no action;`);

    this.addSql(`alter table "wms_warehouse_zones" add constraint "wms_warehouse_zones_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id") on update no action on delete no action;`);

    this.addSql(`create index "mcp_oauth_authorization_codes_client_user_idx" on "mcp_oauth_authorization_codes" ("client_id", "user_id");`);
    this.addSql(`alter table "mcp_oauth_authorization_codes" drop constraint if exists "mcp_oauth_authorization_codes_code_hash_unique";`);
    this.addSql(`alter table "mcp_oauth_authorization_codes" add constraint "mcp_oauth_authorization_codes_code_hash_uq" unique ("code_hash");`);

    this.addSql(`create index "mcp_oauth_clients_tenant_idx" on "mcp_oauth_clients" ("tenant_id");`);
    this.addSql(`alter table "mcp_oauth_clients" drop constraint if exists "mcp_oauth_clients_client_id_unique";`);
    this.addSql(`alter table "mcp_oauth_clients" add constraint "mcp_oauth_clients_client_id_uq" unique ("client_id");`);
    this.addSql(`alter table "mcp_oauth_clients" add constraint "mcp_oauth_clients_registration_source_check" check ("registration_source" in ('preconfigured', 'dynamic', 'cimd'));`);

    this.addSql(`create index "mcp_oauth_refresh_tokens_client_user_idx" on "mcp_oauth_refresh_tokens" ("client_id", "user_id");`);
    this.addSql(`alter table "mcp_oauth_refresh_tokens" drop constraint if exists "mcp_oauth_refresh_tokens_token_hash_unique";`);
    this.addSql(`alter table "mcp_oauth_refresh_tokens" add constraint "mcp_oauth_refresh_tokens_token_hash_uq" unique ("token_hash");`);
  }

}
