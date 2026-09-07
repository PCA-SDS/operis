import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@open-mercato/shared/lib/db/decorators'

export type StaffLeaveRequestStatus = 'pending' | 'approved' | 'rejected'

export type StaffEmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern' | 'temporary'

export const STAFF_EMPLOYMENT_TYPES: StaffEmploymentType[] = [
  'full_time',
  'part_time',
  'contract',
  'intern',
  'temporary',
]

@Entity({ tableName: 'staff_teams' })
@Index({ name: 'staff_teams_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeam {
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

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_team_roles' })
@Index({ name: 'staff_team_roles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamRole {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'team_id', type: 'uuid', nullable: true })
  teamId?: string | null

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

@Entity({ tableName: 'staff_team_members' })
@Index({ name: 'staff_team_members_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamMember {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'team_id', type: 'uuid', nullable: true })
  teamId?: string | null

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'role_ids', type: 'jsonb', default: [] })
  roleIds: string[] = []

  @Property({ type: 'jsonb', default: [] })
  tags: string[] = []

  @Property({ name: 'availability_rule_set_id', type: 'uuid', nullable: true })
  availabilityRuleSetId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_leave_requests' })
@Index({ name: 'staff_leave_requests_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_leave_requests_member_idx', properties: ['member'] })
@Index({ name: 'staff_leave_requests_status_idx', properties: ['status', 'tenantId', 'organizationId'] })
export class StaffLeaveRequest {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember

  @Property({ name: 'start_date', type: Date })
  startDate!: Date

  @Property({ name: 'end_date', type: Date })
  endDate!: Date

  @Property({ type: 'text' })
  timezone!: string

  @Enum({ items: ['pending', 'approved', 'rejected'], type: 'text', name: 'status' })
  status: StaffLeaveRequestStatus = 'pending'

  @Property({ name: 'unavailability_reason_entry_id', type: 'uuid', nullable: true })
  unavailabilityReasonEntryId?: string | null

  @Property({ name: 'unavailability_reason_value', type: 'text', nullable: true })
  unavailabilityReasonValue?: string | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'decision_comment', type: 'text', nullable: true })
  decisionComment?: string | null

  @Property({ name: 'submitted_by_user_id', type: 'uuid', nullable: true })
  submittedByUserId?: string | null

  @Property({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_team_member_comments' })
@Index({ name: 'staff_team_member_comments_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_comments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamMemberComment {
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

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}

@Entity({ tableName: 'staff_team_member_activities' })
@Index({ name: 'staff_team_member_activities_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_activities_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_team_member_activities_member_occurred_created_idx', properties: ['member', 'occurredAt', 'createdAt'] })
export class StaffTeamMemberActivity {
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

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}

@Entity({ tableName: 'staff_team_member_job_histories' })
@Index({ name: 'staff_team_member_job_histories_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_job_histories_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_team_member_job_histories_member_start_idx', properties: ['member', 'startDate'] })
export class StaffTeamMemberJobHistory {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'company_name', type: 'text', nullable: true })
  companyName?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'start_date', type: Date })
  startDate!: Date

  @Property({ name: 'end_date', type: Date, nullable: true })
  endDate?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}

@Entity({ tableName: 'staff_team_member_addresses' })
@Index({ name: 'staff_team_member_addresses_member_idx', properties: ['member'] })
@Index({ name: 'staff_team_member_addresses_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StaffTeamMemberAddress {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'name', type: 'text', nullable: true })
  name?: string | null

  @Property({ name: 'purpose', type: 'text', nullable: true })
  purpose?: string | null

  @Property({ name: 'company_name', type: 'text', nullable: true })
  companyName?: string | null

  @Property({ name: 'address_line1', type: 'text' })
  addressLine1!: string

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  @Property({ name: 'city', type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'region', type: 'text', nullable: true })
  region?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ name: 'country', type: 'text', nullable: true })
  country?: string | null

  @Property({ name: 'building_number', type: 'text', nullable: true })
  buildingNumber?: string | null

  @Property({ name: 'flat_number', type: 'text', nullable: true })
  flatNumber?: string | null

  @Property({ name: 'latitude', type: 'float', nullable: true })
  latitude?: number | null

  @Property({ name: 'longitude', type: 'float', nullable: true })
  longitude?: number | null

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember
}

// --- Timesheets entities (Phase 1) ---

export type StaffTimeEntrySource = 'manual' | 'timer' | 'kiosk' | 'mobile'
export type StaffTimeProjectStatus = 'active' | 'on_hold' | 'completed'
export type StaffTimeProjectMemberStatus = 'active' | 'inactive'
export type StaffTimeEntrySegmentType = 'work' | 'break'

@Entity({ tableName: 'staff_time_entries' })
@Index({ name: 'staff_time_entries_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_entries_member_date_idx', properties: ['organizationId', 'staffMemberId', 'date'] })
@Index({ name: 'staff_time_entries_project_date_idx', properties: ['organizationId', 'timeProjectId', 'date'] })
export class StaffTimeEntry {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'staff_member_id', type: 'uuid' })
  staffMemberId!: string

  @Property({ name: 'date', type: 'date' })
  date!: Date

  @Property({ name: 'duration_minutes', type: 'integer', default: 0 })
  durationMinutes: number = 0

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'ended_at', type: Date, nullable: true })
  endedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'time_project_id', type: 'uuid', nullable: true })
  timeProjectId?: string | null

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Enum({ items: ['manual', 'timer', 'kiosk', 'mobile'], type: 'text', name: 'source', default: 'manual' })
  source: StaffTimeEntrySource = 'manual'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_entry_segments' })
@Index({ name: 'staff_time_entry_segments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_entry_segments_entry_idx', properties: ['timeEntryId'] })
export class StaffTimeEntrySegment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'time_entry_id', type: 'uuid' })
  timeEntryId!: string

  @Property({ name: 'started_at', type: Date })
  startedAt!: Date

  @Property({ name: 'ended_at', type: Date, nullable: true })
  endedAt?: Date | null

  @Enum({ items: ['work', 'break'], type: 'text', name: 'segment_type', default: 'work' })
  segmentType: StaffTimeEntrySegmentType = 'work'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_projects' })
@Index({ name: 'staff_time_projects_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_projects_code_unique_idx', properties: ['organizationId', 'tenantId', 'code'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeProject {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'project_type', type: 'text', nullable: true })
  projectType?: string | null

  @Property({ type: 'varchar', length: 20, nullable: true })
  color?: string | null

  @Enum({ items: ['active', 'on_hold', 'completed'], type: 'text', name: 'status', default: 'active' })
  status: StaffTimeProjectStatus = 'active'

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'cost_center', type: 'text', nullable: true })
  costCenter?: string | null

  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'staff_time_project_members' })
@Index({ name: 'staff_time_project_members_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_time_project_members_project_idx', properties: ['organizationId', 'timeProjectId'] })
@Index({ name: 'staff_time_project_members_member_idx', properties: ['organizationId', 'staffMemberId'] })
@Index({ name: 'staff_time_project_members_unique_idx', properties: ['organizationId', 'tenantId', 'timeProjectId', 'staffMemberId'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class StaffTimeProjectMember {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'time_project_id', type: 'uuid' })
  timeProjectId!: string

  @Property({ name: 'staff_member_id', type: 'uuid' })
  staffMemberId!: string

  @Property({ type: 'text', nullable: true })
  role?: string | null

  @Enum({ items: ['active', 'inactive'], type: 'text', name: 'status', default: 'active' })
  status: StaffTimeProjectMemberStatus = 'active'

  @Property({ name: 'show_in_grid', type: 'boolean', default: false })
  showInGrid: boolean = false

  @Property({ name: 'assigned_start_date', type: 'date' })
  assignedStartDate!: Date

  @Property({ name: 'assigned_end_date', type: 'date', nullable: true })
  assignedEndDate?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * The HR record for a team member: who they are to the company, as opposed to
 * `StaffTeamMember`, which is who they are to the schedule.
 *
 * Kept as its own table rather than columns on `StaffTeamMember` so the HR
 * fields can be permission-gated as a unit — `staff.hr_profile.*` guards this
 * row, while everything that reads the member for scheduling is unaffected and
 * never loads a date of birth it has no business seeing.
 *
 * It hangs off the member, NOT off a user account. `StaffTeamMember.userId` is
 * nullable, so Operis already allows a member with no login; keying the profile
 * to the account would have taken that away.
 *
 * There is deliberately no address column. The reference model carries a single
 * free-text address, but `StaffTeamMemberAddress` already stores structured,
 * multi-address data with geocoding — the richer of the two wins.
 */
@Entity({ tableName: 'staff_employee_profiles' })
@Index({ name: 'staff_employee_profiles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'staff_employee_profiles_member_idx', properties: ['member'] })
export class StaffEmployeeProfile {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /**
   * `ManyToOne` with a partial unique index in the migration, not `OneToOne`.
   *
   * A declared `unique: true` becomes a hard constraint that a soft-deleted row
   * still occupies, so clearing an HR record and entering a fresh one would
   * fail. The module solves this the same way elsewhere
   * (`staff_time_projects_code_unique_idx`): a plain index on the entity, and a
   * `where deleted_at is null` unique index in SQL.
   */
  @ManyToOne(() => StaffTeamMember, { fieldName: 'member_id' })
  member!: StaffTeamMember

  @Property({ name: 'employee_number', type: 'text', nullable: true })
  employeeNumber?: string | null

  @Property({ name: 'job_title', type: 'text', nullable: true })
  jobTitle?: string | null

  @Enum({ items: () => STAFF_EMPLOYMENT_TYPES, type: 'text', name: 'employment_type', nullable: true })
  employmentType?: StaffEmploymentType | null

  /**
   * Calendar dates, so a Postgres `date` rather than a timestamp.
   *
   * A start date is the same day in every timezone. Stored as `timestamptz` it
   * would be read back shifted for anyone west of UTC — a 2026-01-05 start
   * showing as 2026-01-04 — and this module already uses `date` for
   * `StaffTimeEntry.date` for the same reason.
   *
   * Typed `string`, not `Date`, because that is what the driver actually hands
   * back for a `date` column. Declaring `Date` here is what made the snapshot
   * loader call `toISOString()` on a string and return a 500.
   */
  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: string | null

  @Property({ name: 'end_date', type: 'date', nullable: true })
  endDate?: string | null

  @Property({ name: 'work_phone', type: 'text', nullable: true })
  workPhone?: string | null

  @Property({ name: 'personal_phone', type: 'text', nullable: true })
  personalPhone?: string | null

  @Property({ name: 'personal_email', type: 'text', nullable: true })
  personalEmail?: string | null

  /**
   * Text, not a date column, because this field is encrypted at rest.
   *
   * Encryption replaces the value with a ciphertext string, which a `date`
   * column cannot hold — the write would fail outright. It is never sorted or
   * filtered on, so nothing is lost by storing the `YYYY-MM-DD` as text.
   */
  @Property({ name: 'date_of_birth', type: 'text', nullable: true })
  dateOfBirth?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
