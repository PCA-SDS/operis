import { Collection, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

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

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
