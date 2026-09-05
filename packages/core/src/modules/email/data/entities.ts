import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'
import type { EmailTemplateStatus } from './validators'

@Entity({ tableName: 'email_templates' })
@Index({ name: 'email_templates_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'email_templates_category_status_idx', properties: ['organizationId', 'tenantId', 'category', 'status'] })
@Index({ name: 'email_templates_updated_idx', properties: ['organizationId', 'tenantId', 'updatedAt'] })
@Index({
  name: 'email_templates_key_scope_unique_idx',
  expression:
    'create unique index "email_templates_key_scope_unique_idx" on "email_templates" ("organization_id", "tenant_id", "template_key") where deleted_at is null',
})
export class EmailTemplate {
  [OptionalProps]?: 'status' | 'description' | 'preheader' | 'design' | 'blocks' | 'variables' | 'accountingMetadata' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'template_key', type: 'text' })
  templateKey!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', default: 'accounting' })
  category: string = 'accounting'

  @Property({ type: 'text', default: 'draft' })
  status: EmailTemplateStatus = 'draft'

  @Property({ type: 'text' })
  subject!: string

  @Property({ type: 'text', nullable: true })
  preheader?: string | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  design: unknown = {}

  @Property({ type: 'jsonb', defaultRaw: "'[]'::jsonb" })
  blocks: unknown = []

  @Property({ type: 'jsonb', defaultRaw: "'[]'::jsonb" })
  variables: unknown = []

  @Property({ name: 'accounting_metadata', type: 'jsonb', nullable: true })
  accountingMetadata?: unknown | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'email_accounting_defaults' })
@Unique({ name: 'email_accounting_defaults_scope_unique', properties: ['organizationId', 'tenantId'] })
export class EmailAccountingDefaults {
  [OptionalProps]?: 'defaultSenderName' | 'defaultReplyTo' | 'placeholders' | 'linkPlaceholders' | 'rules' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'default_sender_name', type: 'text', nullable: true })
  defaultSenderName?: string | null

  @Property({ name: 'default_reply_to', type: 'text', nullable: true })
  defaultReplyTo?: string | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  placeholders: unknown = {}

  @Property({ name: 'link_placeholders', type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  linkPlaceholders: unknown = {}

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  rules: unknown = {}

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
