import { Collection } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'tenants' })
export class Tenant {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => Organization, (o) => o.tenant)
  organizations = new Collection<Organization>(this)
}

/**
 * Per-tenant module entitlement.
 *
 * Answers "does this tenant have this module at all", which is a different
 * question from "may this user use it" (that stays in RoleAcl/UserAcl). A row
 * is required for a tenant to reach an entitleable module: the absence of a row
 * denies, so a newly shipped module stays dark until it is granted explicitly.
 *
 * Infrastructure modules listed in `PLATFORM_MODULE_IDS` are never represented
 * here — gating auth or directory would lock every tenant out of its own login.
 */
@Entity({ tableName: 'tenant_modules' })
@Unique({ name: 'tenant_modules_tenant_module_uniq', properties: ['tenant', 'moduleId'] })
@Index({ name: 'tenant_modules_tenant_idx', properties: ['tenant'] })
export class TenantModule {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Tenant)
  tenant!: Tenant

  @Property({ name: 'module_id', type: 'text' })
  moduleId!: string

  @Property({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'organizations' })
@Unique({ name: 'organizations_tenant_slug_uniq', properties: ['tenant', 'slug'] })
export class Organization {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Tenant)
  tenant!: Tenant

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  slug?: string | null

  @Property({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl?: string | null

  @Property({ name: 'logo_preserve_aspect_ratio', type: 'boolean', default: false })
  logoPreserveAspectRatio: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null = null

  @Property({ name: 'root_id', type: 'uuid', nullable: true })
  rootId: string | null = null

  @Property({ name: 'tree_path', type: 'text', nullable: true })
  treePath: string | null = null

  @Property({ type: 'int', default: 0 })
  depth: number = 0

  @Property({ name: 'ancestor_ids', type: 'jsonb', default: [], nullable: false })
  ancestorIds: string[] = []

  @Property({ name: 'child_ids', type: 'jsonb', default: [], nullable: false })
  childIds: string[] = []

  @Property({ name: 'descendant_ids', type: 'jsonb', default: [], nullable: false })
  descendantIds: string[] = []

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
