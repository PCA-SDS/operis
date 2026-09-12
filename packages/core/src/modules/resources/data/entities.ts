import { Collection, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'

@Entity({ tableName: 'resources_resource_area_types' })
@Index({ name: 'resources_resource_area_types_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class ResourcesResourceAreaType {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'resources_resource_types' })
@Index({ name: 'resources_resource_types_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class ResourcesResourceType {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'resources_resources' })
@Index({ name: 'resources_resources_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class ResourcesResource {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'resource_type_id', type: 'uuid', nullable: true })
  resourceTypeId?: string | null

  @Property({ name: 'area_id', type: 'uuid', nullable: true })
  areaId?: string | null

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ type: 'int', nullable: true })
  capacity?: number | null

  @Property({ name: 'capacity_unit_value', type: 'text', nullable: true })
  capacityUnitValue?: string | null

  @Property({ name: 'capacity_unit_name', type: 'text', nullable: true })
  capacityUnitName?: string | null

  @Property({ name: 'capacity_unit_color', type: 'text', nullable: true })
  capacityUnitColor?: string | null

  @Property({ name: 'capacity_unit_icon', type: 'text', nullable: true })
  capacityUnitIcon?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'availability_rule_set_id', type: 'uuid', nullable: true })
  availabilityRuleSetId?: string | null

  @Property({ name: 'custom_fieldset_code', type: 'text', nullable: true })
  customFieldsetCode?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'resources_resource_comments' })
@Index({ name: 'resources_resource_comments_resource_idx', properties: ['resource'] })
@Index({ name: 'resources_resource_comments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class ResourcesResourceComment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'body', type: 'text' })
  body!: string

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @ManyToOne(() => ResourcesResource, { fieldName: 'resource_id' })
  resource!: ResourcesResource
}

@Entity({ tableName: 'resources_resource_activities' })
@Index({ name: 'resources_resource_activities_resource_idx', properties: ['resource'] })
@Index({ name: 'resources_resource_activities_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'resources_resource_activities_resource_occurred_created_idx', properties: ['resource', 'occurredAt', 'createdAt'] })
export class ResourcesResourceActivity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'activity_type', type: 'text' })
  activityType!: string

  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'occurred_at', type: Date, nullable: true })
  occurredAt?: Date | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => ResourcesResource, { fieldName: 'resource_id' })
  resource!: ResourcesResource
}

@Entity({ tableName: 'resources_resource_tags' })
@Index({ name: 'resources_resource_tags_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'resources_resource_tags_slug_unique', properties: ['organizationId', 'tenantId', 'slug'] })
export class ResourcesResourceTag {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => ResourcesResourceTagAssignment, (assignment) => assignment.tag)
  assignments = new Collection<ResourcesResourceTagAssignment>(this)
}

@Entity({ tableName: 'resources_resource_tag_assignments' })
@Index({ name: 'resources_resource_tag_assignments_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'resources_resource_tag_assignments_unique',
  properties: ['tag', 'resource'],
})
export class ResourcesResourceTagAssignment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => ResourcesResourceTag, { fieldName: 'tag_id' })
  tag!: ResourcesResourceTag

  @ManyToOne(() => ResourcesResource, { fieldName: 'resource_id' })
  resource!: ResourcesResource

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'resources_resource_areas' })
@Index({ name: 'resources_resource_areas_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'resources_resource_areas_parent_idx', properties: ['parentAreaId'] })
export class ResourcesResourceArea {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @ManyToOne(() => ResourcesResourceAreaType, { fieldName: 'area_type_id', nullable: true })
  areaType?: ResourcesResourceAreaType | null

  @Property({ name: 'parent_area_id', type: 'uuid', nullable: true })
  parentAreaId?: string | null

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// =============================================================================
// Resource Assignments - Generic booking system for any module
// =============================================================================

@Entity({ tableName: 'resources_assignments' })
@Index({ name: 'ra_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'ra_resource_time_idx', properties: ['resource', 'startsAt', 'endsAt'] })
@Index({ name: 'ra_source_module_idx', properties: ['sourceModule', 'sourceEntityType', 'sourceEntityId'] })
@Index({ name: 'ra_source_entity_idx', properties: ['sourceEntityId'] })
@Index({ name: 'ra_state_idx', properties: ['state', 'cancelledAt'] })
export class ResourcesAssignment {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'title'
    | 'assignedMemberId'
    | 'cancelledAt'
    | 'createdByUserId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  // === GENERIC SOURCE IDENTIFICATION ===
  // sourceModule: 'appointment' | 'wms' | 'tasks' | ...
  // sourceEntityType: 'appointment_line' | 'shipment' | 'task' | ...
  // sourceEntityId: UUID of the specific entity
  @Property({ name: 'source_module', type: 'text' })
  sourceModule!: string

  @Property({ name: 'source_entity_type', type: 'text' })
  sourceEntityType!: string

  @Property({ name: 'source_entity_id', type: 'uuid' })
  sourceEntityId!: string

  // === RESOURCE & TIMING ===
  @ManyToOne(() => ResourcesResource, { fieldName: 'resource_id', nullable: true })
  resource?: ResourcesResource | null

  // State: draft (temporary) or confirmed (final)
  @Property({ name: 'state', type: 'text' })
  state!: 'draft' | 'confirmed'

  @Property({ name: 'starts_at', type: Date })
  startsAt!: Date

  @Property({ name: 'ends_at', type: Date })
  endsAt!: Date

  // === STAFF ASSIGNMENT (generic - references staff module) ===
  @Property({ name: 'assigned_member_id', type: 'uuid', nullable: true })
  assignedMemberId?: string | null

  @Property({ type: 'text', nullable: true })
  title?: string | null

  // === AUDIT ===
  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// =============================================================================
// Resource Blocks - Temporary unavailability periods
// =============================================================================

@Entity({ tableName: 'resources_blocks' })
@Index({ name: 'rb_resource_time_idx', properties: ['resource', 'startsAt', 'endsAt'] })
export class ResourcesBlock {
  [OptionalProps]?: 'createdAt' | 'reason' | 'createdByUserId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => ResourcesResource, { fieldName: 'resource_id', nullable: true })
  resource?: ResourcesResource | null

  @Property({ name: 'starts_at', type: Date })
  startsAt!: Date

  @Property({ name: 'ends_at', type: Date })
  endsAt!: Date

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
