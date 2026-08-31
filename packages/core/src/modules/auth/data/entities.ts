import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'

@Entity({ tableName: 'users' })
// Email uniqueness is per-tenant, enforced by a partial unique index
// (`users_tenant_email_hash_uniq`) on `(tenant_id, email_hash)` over live rows
// (`WHERE deleted_at IS NULL AND email_hash IS NOT NULL`), owned by raw SQL in
// Migration20260610120000. It keys on the deterministic `email_hash`, not `email`, because
// `email` is encrypted at rest with a per-row IV (see encryption.ts) — its ciphertext is
// non-deterministic, so a unique index on it would not detect duplicates. A `@Unique`
// decorator can't express a partial, tenant-scoped index, so the entity omits it — the
// migration is the source of truth. A global unique constraint contradicts the multi-tenant
// login flow and leaks cross-tenant account existence (#2934). Mirrors
// `customer_users_tenant_email_hash_uniq`.
export class User {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'email_hash', type: 'text', nullable: true })
  @Index({ name: 'users_email_hash_idx' })
  emailHash?: string | null

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null

  @Property({ name: 'is_confirmed', type: 'boolean', default: true })
  isConfirmed: boolean = true

  @Property({ name: 'last_login_at', type: Date, nullable: true })
  lastLoginAt?: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Per-user module restriction — the second entitlement layer.
 *
 * A row with `isEnabled = false` withholds one module from one user. Absence of
 * a row means "not restricted": the resolver subtracts restricted ids from the
 * tenant's entitled set and never adds to it, so this table can only ever
 * narrow access, never widen it past what the Super Admin granted the tenant.
 */
@Entity({ tableName: 'user_modules' })
@Unique({ name: 'user_modules_user_module_uniq', properties: ['user', 'moduleId'] })
@Index({ name: 'user_modules_tenant_idx', properties: ['tenantId'] })
export class UserModule {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User, { fieldName: 'user_id' })
  user!: User

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

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

@Entity({ tableName: 'roles' })
@Unique({ properties: ['tenantId', 'name'] })
export class Role {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'min_active_holders', type: 'integer', default: 0 })
  minActiveHolders: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'user_sidebar_preferences' })
// Uniqueness is enforced by a partial unique index (`user_sidebar_preferences_active_unique_idx`)
// scoped to live rows (`WHERE deleted_at IS NULL`) and owned by raw SQL in
// Migration20260427143311. A `@Unique` decorator can't express a partial index,
// so the entity intentionally omits it — the migration is the source of truth.
export class UserSidebarPreference {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ type: 'text' })
  locale!: string

  @Property({ name: 'settings_json', type: 'json', nullable: true })
  settingsJson?: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'role_sidebar_preferences' })
// Uniqueness is enforced by a partial unique index (`role_sidebar_preferences_active_unique_idx`)
// scoped to live rows (`WHERE deleted_at IS NULL`) and owned by raw SQL in
// Migration20260427143311. A `@Unique` decorator can't express a partial index,
// so the entity intentionally omits it — the migration is the source of truth.
export class RoleSidebarPreference {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Role)
  role!: Role

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ type: 'text' })
  locale!: string

  @Property({ name: 'settings_json', type: 'json', nullable: true })
  settingsJson?: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sidebar_variants' })
// Uniqueness is enforced by a partial unique index (`sidebar_variants_active_name_unique_idx`)
// scoped to live rows (`WHERE deleted_at IS NULL`) and owned by raw SQL in
// Migration20260427143311. A `@Unique` decorator can't express a partial index,
// so the entity intentionally omits it — the migration is the source of truth.
export class SidebarVariant {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ type: 'text' })
  locale!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'settings_json', type: 'json', nullable: true })
  settingsJson?: unknown

  @Property({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'user_roles' })
@Index({ name: 'user_roles_user_id_idx', properties: ['user'] })
@Index({ name: 'user_roles_role_id_idx', properties: ['role'] })
export class UserRole {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @ManyToOne(() => Role)
  role!: Role

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sessions' })
export class Session {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @Property({ type: 'text', unique: true })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'password_resets' })
export class PasswordReset {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @Property({ type: 'text', unique: true })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// RBAC: Role-level ACL
@Entity({ tableName: 'role_acls' })
// Read on every RBAC cache miss — `rbacService.getGrantedFeatures` loads
// `{ tenantId, role: { $in: roleIds } }` and `isGlobalSuperAdmin` probes by role.
// The table shipped with no index at all beyond the PK, so both were sequential
// scans on the authorization path of every cold request. `role` leads so the
// role-only probes are served by the same index.
// Deliberately an index, not the @Unique its customer_accounts twin carries
// (customer_role_acls): adding a unique constraint to a populated table fails on
// pre-existing duplicates, which is a data-integrity decision, not a perf one.
@Index({ name: 'role_acls_role_tenant_idx', properties: ['role', 'tenantId'] })
export class RoleAcl {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Role)
  role!: Role

  // Tenant scope is mandatory for ACL evaluation
  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Feature list (string-based). Use JSON array to preserve order and allow wildcards like "example.*".
  @Property({ name: 'features_json', type: 'json', nullable: true })
  featuresJson?: string[] | null

  // If true, user with this role can do everything regardless of features
  @Property({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin: boolean = false

  // Visible organizations within the tenant; null/empty means all organizations
  @Property({ name: 'organizations_json', type: 'json', nullable: true })
  organizationsJson?: string[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// RBAC: Per-user ACL override
@Entity({ tableName: 'user_acls' })
// Same story as role_acls above: `em.findOne(UserAcl, { user, tenantId })` runs on
// every RBAC cache miss against a table with no non-PK index. Mirrors the
// customer_accounts twin (customer_user_acls), minus the uniqueness.
@Index({ name: 'user_acls_user_tenant_idx', properties: ['user', 'tenantId'] })
export class UserAcl {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  // Tenant scope is mandatory for ACL evaluation
  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Feature list (string-based). Use JSON array to preserve order and allow wildcards like "example.*".
  @Property({ name: 'features_json', type: 'json', nullable: true })
  featuresJson?: string[] | null

  // If true, this user can do everything regardless of features
  @Property({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin: boolean = false

  // Visible organizations within the tenant; null/empty means all organizations
  @Property({ name: 'organizations_json', type: 'json', nullable: true })
  organizationsJson?: string[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'user_consents' })
@Unique({ properties: ['userId', 'tenantId', 'consentType'] })
export class UserConsent {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'consent_type', type: 'text' })
  consentType!: string

  @Property({ name: 'is_granted', type: 'boolean', default: false })
  isGranted: boolean = false

  @Property({ name: 'granted_at', type: Date, nullable: true })
  grantedAt?: Date | null

  @Property({ name: 'withdrawn_at', type: Date, nullable: true })
  withdrawnAt?: Date | null

  @Property({ type: 'text', nullable: true })
  source?: string | null

  @Property({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress?: string | null

  @Property({ name: 'integrity_hash', type: 'text', nullable: true })
  integrityHash?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
