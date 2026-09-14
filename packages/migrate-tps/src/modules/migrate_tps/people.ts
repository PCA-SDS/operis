import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import * as pg from 'pg'
import { randomUUID } from 'node:crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { computeEmailLookupHash, resolvePhoneIdentity } from '@open-mercato/core/modules/customers/lib/contactIdentity'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { StaffTeamMember, StaffTeamRole } from '@open-mercato/core/modules/staff/data/entities'
import { TPS_LOCATION_MAPPING } from './lib'

type Client = InstanceType<typeof pg.Client>

type TpsCustomer = {
  id: string
  name: string
  salutation: string | null
  email: string | null
  password: string
  phone: string
  phone_country_code: string
  phone_country: string
  origin: string
}

type TpsAccount = {
  id: string
  name: string
  email: string | null
  password: string
  all_locations: boolean
  locations: string[] | null
}

type TpsAccountJobRole = {
  account_id: string
  job_role_id: string
  job_role_name: string
  job_role_code: string | null
  job_role_description: string | null
}

const logger = createLogger('migrate_tps')
const CUSTOMER_MARKER_PREFIX = 'tps-customer-id:'
const STAFF_MARKER_PREFIX = 'tps-account-id:'
const STAFF_ROLE_MARKER_PREFIX = 'tps-job-role-id:'

async function connectTps(url: string): Promise<Client> {
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

function splitName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] ?? 'Unknown', lastName: '-' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? '-' }
}

function normalizeSalutation(value: string | null): string | null {
  if (!value || value === 'None') return null
  return value.trim() || null
}

function canonicalizePhone(phone: string, countryCode: string): string {
  const digits = phone.replace(/\D/g, '')
  const code = countryCode.replace(/\D/g, '')
  if (!digits || !code) return phone.trim()
  if (digits.startsWith(code)) return `+${code} ${digits.slice(code.length)}`
  return `+${code} ${digits}`
}

function sourceMarker(prefix: string, id: string): string {
  return `[${prefix}${id}]`
}

function accountLocations(account: TpsAccount): string[] {
  if (account.all_locations) return TPS_LOCATION_MAPPING.map((mapping) => mapping.tpsKey)
  return (account.locations ?? []).filter((location) => TPS_LOCATION_MAPPING.some((mapping) => mapping.tpsKey === location))
}

async function loadBranchOrganizations(
  em: EntityManager,
  tenantId: string,
  rootOrgId: string,
): Promise<Map<string, Organization>> {
  const organizations = await em.find(Organization, {
    tenant: tenantId as unknown as any,
    parentId: rootOrgId,
    deletedAt: null,
  })
  const bySlug = new Map(organizations.map((organization) => [organization.slug, organization]))
  const result = new Map<string, Organization>()
  for (const mapping of TPS_LOCATION_MAPPING) {
    const organization = bySlug.get(mapping.slug)
    if (organization) result.set(mapping.tpsKey, organization)
    else logger.warn(`No Operis organization found for TPS location "${mapping.tpsKey}"`)
  }
  return result
}

async function migrateCustomers(
  em: EntityManager,
  customers: TpsCustomer[],
  tenantId: string,
  rootOrgId: string,
  replace: boolean,
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0
  let updated = 0
  let skipped = 0

  for (const source of customers) {
    const marker = sourceMarker(CUSTOMER_MARKER_PREFIX, source.id)
    const phone = canonicalizePhone(source.phone, source.phone_country_code)
    const phoneIdentity = resolvePhoneIdentity({
      primaryPhone: phone,
      phoneCountryCode: source.phone_country_code,
      phoneCountry: source.phone_country,
    })
    const email = source.email?.trim().toLowerCase() || null
    let entity = await em.findOne(CustomerEntity, { tenantId, kind: 'person', deletedAt: null, description: marker })
    if (!entity && phoneIdentity.primaryPhoneHash) {
      entity = await em.findOne(CustomerEntity, {
        tenantId,
        kind: 'person',
        deletedAt: null,
        primaryPhoneHash: phoneIdentity.primaryPhoneHash,
      })
    }
    if (!entity && email) {
      entity = await em.findOne(CustomerEntity, {
        tenantId,
        kind: 'person',
        deletedAt: null,
        primaryEmailHash: computeEmailLookupHash(email),
      })
    }

    const { firstName, lastName } = splitName(source.name)
    if (entity) {
      if (!replace) {
        skipped++
        continue
      }
      entity.organizationId = rootOrgId
      entity.displayName = source.name.trim()
      entity.description = marker
      entity.primaryEmail = email
      entity.primaryEmailHash = computeEmailLookupHash(email)
      entity.primaryPhone = phoneIdentity.primaryPhone
      entity.primaryPhoneHash = phoneIdentity.primaryPhoneHash
      entity.phoneCountryCode = phoneIdentity.phoneCountryCode
      entity.phoneCountry = phoneIdentity.phoneCountry
      entity.source = 'tps'
      entity.origin = source.origin?.trim() || null
      const profile = await em.findOne(CustomerPersonProfile, { entity: entity.id })
      if (profile) {
        profile.organizationId = rootOrgId
        profile.firstName = firstName
        profile.lastName = lastName
        profile.salutation = normalizeSalutation(source.salutation)
      }
      updated++
      continue
    }

    entity = em.create(CustomerEntity, {
      id: randomUUID(),
      organizationId: rootOrgId,
      tenantId,
      kind: 'person',
      displayName: source.name.trim(),
      description: marker,
      primaryEmail: email,
      primaryEmailHash: computeEmailLookupHash(email),
      primaryPhone: phoneIdentity.primaryPhone,
      primaryPhoneHash: phoneIdentity.primaryPhoneHash,
      phoneCountryCode: phoneIdentity.phoneCountryCode,
      phoneCountry: phoneIdentity.phoneCountry,
      source: 'tps',
      origin: source.origin?.trim() || null,
      lifecycleStage: 'customer',
      status: 'active',
      isActive: true,
    })
    const profile = em.create(CustomerPersonProfile, {
      id: randomUUID(),
      organizationId: rootOrgId,
      tenantId,
      entity,
      salutation: normalizeSalutation(source.salutation),
      firstName,
      lastName,
      company: null,
    })
    em.persist(entity)
    em.persist(profile)
    created++
  }
  return { created, updated, skipped }
}

async function migrateStaff(
  em: EntityManager,
  accounts: TpsAccount[],
  accountJobRoles: Map<string, TpsAccountJobRole[]>,
  branchOrganizations: Map<string, Organization>,
  tenantId: string,
  replace: boolean,
): Promise<{ created: number; updated: number; skipped: number; unlinked: number; rolesCreated: number; rolesAssigned: number }> {
  const emailHashes = accounts
    .map((account) => computeEmailHash(account.email ?? ''))
    .filter((hash): hash is string => Boolean(hash))
  const users = emailHashes.length
    ? await em.find(User, { tenantId, deletedAt: null, emailHash: { $in: emailHashes } })
    : []
  const userByEmailHash = new Map(users.map((user) => [user.emailHash, user]))
  let created = 0
  let updated = 0
  let skipped = 0
  let unlinked = 0
  let rolesCreated = 0
  let rolesAssigned = 0
  const roleByOrganizationAndSourceId = new Map<string, StaffTeamRole>()

  const employeeRole = await em.findOne(Role, { tenantId, name: 'employee', deletedAt: null })
  if (!employeeRole) throw new Error(`Operis role "employee" was not found for tenant ${tenantId}`)

  for (const account of accounts) {
    const emailHash = account.email?.trim() ? computeEmailHash(account.email) : null
    let user = emailHash ? userByEmailHash.get(emailHash) : undefined
    if (!user && account.email?.trim()) {
      user = em.create(User, {
        id: randomUUID(),
        tenantId,
        organizationId: null,
        email: account.email.trim().toLowerCase(),
        emailHash,
        name: account.name.trim(),
        passwordHash: account.password,
        isConfirmed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(user)
      em.persist(em.create(UserRole, { user, role: employeeRole, createdAt: new Date() }))
      if (emailHash) userByEmailHash.set(emailHash, user)
    }
    const sourceRoles = accountJobRoles.get(account.id) ?? []
    for (const location of accountLocations(account)) {
      const organization = branchOrganizations.get(location)
      if (!organization) continue
      const roleIds: string[] = []
      for (const sourceRole of sourceRoles) {
        const roleKey = `${organization.id}:${sourceRole.job_role_id}`
        let role: StaffTeamRole | null = roleByOrganizationAndSourceId.get(roleKey) ?? null
        if (!role) {
          const roleMarker = sourceMarker(STAFF_ROLE_MARKER_PREFIX, sourceRole.job_role_id)
          role = await em.findOne(StaffTeamRole, {
            tenantId,
            organizationId: organization.id,
            description: roleMarker,
            deletedAt: null,
          })
          if (!role) {
            role = await em.findOne(StaffTeamRole, {
              tenantId,
              organizationId: organization.id,
              name: sourceRole.job_role_name.trim(),
              deletedAt: null,
            })
          }
          if (!role) {
            role = em.create(StaffTeamRole, {
              id: randomUUID(),
              tenantId,
              organizationId: organization.id,
              name: sourceRole.job_role_name.trim(),
              description: roleMarker,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            em.persist(role)
            rolesCreated++
          }
          roleByOrganizationAndSourceId.set(roleKey, role)
        }
        roleIds.push(role.id)
      }
      const marker = sourceMarker(STAFF_MARKER_PREFIX, account.id)
      let member = await em.findOne(StaffTeamMember, {
        tenantId,
        organizationId: organization.id,
        deletedAt: null,
        description: marker,
      })
      if (member) {
        member.displayName = account.name.trim()
        member.userId = user?.id ?? null
        member.isActive = true
        const nextRoleIds = replace
          ? roleIds
          : Array.from(new Set([...(member.roleIds ?? []), ...roleIds]))
        if (JSON.stringify(member.roleIds ?? []) !== JSON.stringify(nextRoleIds)) {
          member.roleIds = nextRoleIds
          rolesAssigned += roleIds.length
          updated++
        } else if (replace) {
          updated++
        } else {
          skipped++
        }
        if (!user) unlinked++
        continue
      }
      member = em.create(StaffTeamMember, {
        id: randomUUID(),
        tenantId,
        organizationId: organization.id,
        displayName: account.name.trim(),
        description: marker,
        userId: user?.id ?? null,
        roleIds,
        tags: ['tps'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(member)
      created++
      rolesAssigned += roleIds.length
      if (!user) unlinked++
    }
  }
  return { created, updated, skipped, unlinked, rolesCreated, rolesAssigned }
}

export const migrateTpsPeopleCommand: ModuleCli = {
  command: 'people',
  async run(rest) {
    const positional = rest.filter((argument) => !argument.startsWith('--'))
    const tenantId = positional[0]
    const rootOrgId = positional[1]
    if (!tenantId || !rootOrgId) {
      logger.error('Usage: yarn mercato migrate_tps people <tenantId> <rootOrgId> [--replace]')
      throw new Error('Missing tenantId or rootOrgId')
    }
    const tpsUrl = process.env.TPS_DATABASE_URL
    if (!tpsUrl) throw new Error('TPS_DATABASE_URL is required for people migration')
    const replace = rest.includes('--replace')
    const staffOnly = rest.includes('--staff-only')
    const container = await createRequestContainer()
    let client: Client | null = null
    try {
      client = await connectTps(tpsUrl)
      const [customerResult, accountResult, accountJobRoleResult] = await Promise.all([
        staffOnly
          ? Promise.resolve({ rows: [] as TpsCustomer[] })
          : client.query<TpsCustomer>('SELECT id, name, salutation::text, email, phone, phone_country_code, phone_country, origin FROM customers ORDER BY id'),
        client.query<TpsAccount>(`SELECT a.id, a.name, a.email, a.password, a.all_locations, a.locations
          FROM accounts a JOIN roles r ON r.id = a.role_id
          WHERE upper(r.name) = 'STAFF' ORDER BY a.id`),
        client.query<TpsAccountJobRole>(`SELECT ajr.account_id, jr.id AS job_role_id, jr.name AS job_role_name,
            jr.code AS job_role_code, jr.description AS job_role_description
          FROM account_job_roles ajr
          JOIN job_roles jr ON jr.id = ajr.job_role_id
          WHERE jr.deleted_at IS NULL
          ORDER BY ajr.account_id, jr.name`),
      ])
      const accountJobRoles = new Map<string, TpsAccountJobRole[]>()
      for (const row of accountJobRoleResult.rows) {
        const roles = accountJobRoles.get(row.account_id) ?? []
        roles.push(row)
        accountJobRoles.set(row.account_id, roles)
      }
      const em = container.resolve<EntityManager>('em').fork()
      const branchOrganizations = await loadBranchOrganizations(em, tenantId, rootOrgId)
      await em.transactional(async (transactionEm) => {
        const customerStats = staffOnly
          ? { created: 0, updated: 0, skipped: 0 }
          : await migrateCustomers(transactionEm, customerResult.rows, tenantId, rootOrgId, replace)
        const staffStats = await migrateStaff(transactionEm, accountResult.rows, accountJobRoles, branchOrganizations, tenantId, replace)
        await transactionEm.flush()
        logger.info(`Customers: created=${customerStats.created}, updated=${customerStats.updated}, skipped=${customerStats.skipped}`)
        logger.info(`Staff memberships: created=${staffStats.created}, updated=${staffStats.updated}, skipped=${staffStats.skipped}, unlinked=${staffStats.unlinked}`)
        logger.info(`Staff job roles: created=${staffStats.rolesCreated}, assigned=${staffStats.rolesAssigned}`)
      })
    } finally {
      if (client) await client.end()
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
    }
  },
}
