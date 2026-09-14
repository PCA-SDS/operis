import { Collection, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'

@Entity({ tableName: 'appointment_statuses' })
@Unique({ name: 'appointment_statuses_tenant_code_unique', properties: ['tenantId', 'code'] })
@Index({ name: 'appointment_statuses_tenant_idx', properties: ['tenantId'] })
export class AppointmentStatus {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'isSystem' | 'sortOrder' | 'description'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean = false

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'appointments' })
@Index({ name: 'appointments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'appointments_requested_start_idx', properties: ['tenantId', 'organizationId', 'requestedStartAt'] })
@Index({ name: 'appointments_customer_idx', properties: ['tenantId', 'customerEntityId'] })
export class Appointment {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'requestedEndAt'
    | 'customerSalutation'
    | 'customerEmail'
    | 'customerPhone'
    | 'customerPhoneCountryCode'
    | 'customerPhoneCountry'
    | 'customerOrigin'
    | 'bookingType'
    | 'notes'
    | 'externalNotes'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'customer_entity_id', type: 'uuid' })
  customerEntityId!: string

  @Property({ name: 'customer_name', type: 'text' })
  customerName!: string

  @Property({ name: 'customer_salutation', type: 'text', nullable: true })
  customerSalutation?: string | null

  @Property({ name: 'customer_email', type: 'text', nullable: true })
  customerEmail?: string | null

  @Property({ name: 'customer_phone', type: 'text', nullable: true })
  customerPhone?: string | null

  @Property({ name: 'customer_phone_country_code', type: 'text', nullable: true })
  customerPhoneCountryCode?: string | null

  @Property({ name: 'customer_phone_country', type: 'text', nullable: true })
  customerPhoneCountry?: string | null

  /** TPS origin (local / tourist / expatriate) — booking attribute, not CRM profile. */
  @Property({ name: 'customer_origin', type: 'text', nullable: true })
  customerOrigin?: string | null

  /** TPS type of booking (call_in / walk_in / …). */
  @Property({ name: 'booking_type', type: 'text', nullable: true })
  bookingType?: string | null

  @ManyToOne(() => AppointmentStatus, { fieldName: 'status_id', deleteRule: 'restrict' })
  status!: AppointmentStatus

  @Property({ name: 'status_code', type: 'text' })
  statusCode!: string

  @Property({ name: 'requested_start_at', type: Date })
  requestedStartAt!: Date

  @Property({ name: 'requested_end_at', type: Date, nullable: true })
  requestedEndAt?: Date | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'external_notes', type: 'text', nullable: true })
  externalNotes?: string | null

  @OneToMany(() => AppointmentLine, (line) => line.appointment)
  lines = new Collection<AppointmentLine>(this)

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'appointment_lines' })
@Index({ name: 'appointment_lines_appointment_idx', properties: ['appointment'] })
@Index({ name: 'appointment_lines_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class AppointmentLine {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'productHandle'
    | 'currencyCode'
    | 'unitPriceNet'
    | 'unitPriceGross'
    | 'durationMinutes'
    | 'sortOrder'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Appointment, { fieldName: 'appointment_id', deleteRule: 'cascade' })
  appointment!: Appointment

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'product_title', type: 'text' })
  productTitle!: string

  @Property({ name: 'product_handle', type: 'text', nullable: true })
  productHandle?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 16, scale: 4, nullable: true })
  unitPriceNet?: string | null

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 16, scale: 4, nullable: true })
  unitPriceGross?: string | null

  @Property({ name: 'duration_minutes', type: 'int', nullable: true })
  durationMinutes?: number | null

  @Property({ name: 'product_category', type: 'text', nullable: true })
  productCategory?: string | null

  @Property({ name: 'selected_options', type: 'jsonb', nullable: true })
  selectedOptions?: Record<string, unknown> | Record<string, unknown>[] | null

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => AppointmentLineOptionGroup, (group) => group.line)
  optionGroups = new Collection<AppointmentLineOptionGroup>(this)
}

/**
 * Snapshot of option groups selected for an appointment line.
 * Preserves the nested group hierarchy from catalog at booking time.
 */
@Entity({ tableName: 'appointment_line_option_groups' })
@Index({ name: 'alog_option_groups_line_idx', properties: ['line'] })
@Index({ name: 'alog_option_groups_catalog_group_idx', properties: ['catalogGroupId'] })
export class AppointmentLineOptionGroup {
  [OptionalProps]?: 'createdAt' | 'sortOrder' | 'requirement' | 'selectMode' | 'isRootGroup' | 'parentOptionId' | 'breadcrumbPath'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => AppointmentLine, { fieldName: 'line_id', deleteRule: 'cascade' })
  line!: AppointmentLine

  /** FK to catalog group for analytics queries */
  @Property({ name: 'catalog_group_id', type: 'uuid', nullable: true })
  catalogGroupId?: string | null

  /** UUID of the option that triggered this group (null = root group) */
  @Property({ name: 'parent_option_id', type: 'uuid', nullable: true })
  parentOptionId?: string | null

  @Property({ name: 'group_name', type: 'text' })
  groupName!: string

  @Property({ name: 'requirement', type: 'text', default: 'optional' })
  requirement: 'required' | 'optional' = 'optional'

  @Property({ name: 'select_mode', type: 'text', default: 'single' })
  selectMode: 'single' | 'multiple' = 'single'

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'breadcrumb_path', type: 'text', nullable: true })
  breadcrumbPath?: string | null

  @Property({ name: 'is_root_group', type: 'boolean', default: false })
  isRootGroup: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @OneToMany(() => AppointmentLineOption, (option) => option.group)
  options = new Collection<AppointmentLineOption>(this)
}

/**
 * Snapshot of individual options selected for an appointment line.
 * Preserves option metadata from catalog at booking time.
 */
@Entity({ tableName: 'appointment_line_options' })
@Index({ name: 'alo_options_group_idx', properties: ['group'] })
@Index({ name: 'alo_options_catalog_option_idx', properties: ['catalogOptionId'] })
export class AppointmentLineOption {
  [OptionalProps]?: 'createdAt' | 'sortOrder' | 'code' | 'note' | 'priceFlat' | 'priceMin' | 'priceMax' | 'durationValue' | 'durationUnit' | 'isAddon'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => AppointmentLineOptionGroup, { fieldName: 'group_id', deleteRule: 'cascade' })
  group!: AppointmentLineOptionGroup

  /** FK to catalog option for analytics queries */
  @Property({ name: 'catalog_option_id', type: 'uuid', nullable: true })
  catalogOptionId?: string | null

  @Property({ name: 'option_name', type: 'text' })
  optionName!: string

  @Property({ type: 'text', nullable: true })
  code?: string | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'price_flat', type: 'numeric', precision: 15, scale: 2, nullable: true })
  priceFlat?: string | null

  @Property({ name: 'price_min', type: 'numeric', precision: 15, scale: 2, nullable: true })
  priceMin?: string | null

  @Property({ name: 'price_max', type: 'numeric', precision: 15, scale: 2, nullable: true })
  priceMax?: string | null

  @Property({ name: 'duration_value', type: 'integer', nullable: true })
  durationValue?: number | null

  @Property({ name: 'duration_unit', type: 'text', nullable: true })
  durationUnit?: string | null

  @Property({ name: 'is_addon', type: 'boolean', default: false })
  isAddon: boolean = false

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
