import { hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Module } from '@open-mercato/shared/modules/registry'
import { getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'
import { ensureTenantUser, setupInitialTenant } from './setup-app'

const logger = createLogger('auth').child({ component: 'seed-dev' })

/**
 * Documented development password. Overridable with `OM_DEV_SEED_PASSWORD` so a
 * shared environment can seed the same accounts without the well-known value.
 * Chosen to satisfy the default password policy (length >= 6, digit, uppercase,
 * special) so the seed works on a stock `.env`.
 */
export const DEFAULT_DEV_SEED_PASSWORD = 'Operis!23'
export const DEV_SEED_PASSWORD_ENV = 'OM_DEV_SEED_PASSWORD'

export type DevSeedUserSpec = {
  email: string
  roles: string[]
  name: string
}

export type DevSeedTenantSpec = {
  /** Tenant + organization display name. */
  name: string
  /** Stable organization slug; also the portal URL segment. */
  slug: string
  /**
   * Platform tenant. Its primary user holds the `superadmin` role, which is the
   * only role carrying `RoleAcl.isSuperAdmin` and therefore the only identity
   * that can scope across tenants. Business tenants are created without the
   * role existing at all, so no tenant administrator can escalate into it.
   */
  isPlatform?: boolean
  users: DevSeedUserSpec[]
  /** Modules withheld from this tenant, to exercise entitlement in the MVP. */
  withheldModules?: string[]
}

/**
 * The canonical development topology.
 *
 * Operis is the platform tenant and is deliberately a separate company from any
 * customer tenant: the platform superadmin must not be reachable by anyone
 * administering Acme. Globex exists so cross-tenant isolation has a real second
 * tenant to be tested against, and withholds `wms` so module entitlement has an
 * observable effect.
 */
export const DEV_SEED_TENANTS: DevSeedTenantSpec[] = [
  {
    name: 'Operis',
    slug: 'operis',
    isPlatform: true,
    users: [
      { email: 'admin@operis.local', roles: ['superadmin'], name: 'Operis Platform Superadmin' },
    ],
  },
  {
    name: 'Acme',
    slug: 'acme',
    users: [
      { email: 'admin@acme.local', roles: ['admin'], name: 'Acme Tenant Admin' },
      { email: 'user@acme.local', roles: ['employee'], name: 'Acme Tenant User' },
    ],
  },
  {
    name: 'Globex',
    slug: 'globex',
    // Withholds a module the shipped plan switches ON, so the seeded topology
    // still demonstrates entitlement having a visible effect. Withholding one
    // that is off everywhere by default would demonstrate nothing.
    withheldModules: ['tasks'],
    users: [
      { email: 'admin@globex.local', roles: ['admin'], name: 'Globex Tenant Admin' },
      { email: 'user@globex.local', roles: ['employee'], name: 'Globex Tenant User' },
    ],
  },
]

export type DevSeedTenantResult = {
  name: string
  slug: string
  tenantId: string
  organizationId: string
  isPlatform: boolean
  users: Array<{ email: string; roles: string[]; created: boolean }>
  modulesGranted: number
  modulesWithheld: string[]
}

export type DevSeedResult = {
  password: string
  passwordFromEnv: boolean
  tenants: DevSeedTenantResult[]
}

export class DevSeedPasswordError extends Error {
  constructor(requirements: string) {
    super(`DEV_SEED_PASSWORD_INVALID: ${DEV_SEED_PASSWORD_ENV} does not meet the password policy (${requirements})`)
    this.name = 'DevSeedPasswordError'
  }
}

export function resolveDevSeedPassword(env: NodeJS.ProcessEnv = process.env): { password: string; fromEnv: boolean } {
  const raw = env[DEV_SEED_PASSWORD_ENV]
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return { password: DEFAULT_DEV_SEED_PASSWORD, fromEnv: false }
  const policy = getPasswordPolicy(env)
  const result = validatePassword(trimmed, policy)
  if (!result.ok) throw new DevSeedPasswordError(result.violations.join(', '))
  return { password: trimmed, fromEnv: true }
}

/**
 * Creates the documented development topology. Safe to re-run: tenants are
 * keyed on their primary user's email, every user write goes through the
 * idempotent `ensureTenantUser`, and module grants only add rows that are not
 * already recorded. Running it twice produces no duplicate tenant,
 * organization, user, role, or module assignment.
 */
export async function seedDevEnvironment(
  em: EntityManager,
  options: { modules: Module[]; env?: NodeJS.ProcessEnv } = { modules: [] },
): Promise<DevSeedResult> {
  const env = options.env ?? process.env
  const { password, fromEnv } = resolveDevSeedPassword(env)
  const passwordHash = await hash(password, 10)
  const tenantModules = new TenantModuleService(em)
  const results: DevSeedTenantResult[] = []

  for (const spec of DEV_SEED_TENANTS) {
    const [primary, ...rest] = spec.users
    if (!primary) continue

    const setupResult = await setupInitialTenant(em, {
      orgName: spec.name,
      orgSlug: spec.slug,
      primaryUser: {
        email: primary.email,
        hashedPassword: passwordHash,
        displayName: primary.name,
        confirm: true,
      },
      primaryUserRoles: primary.roles,
      // A business tenant never gets a `superadmin` role created, so platform
      // administration is unreachable from inside it by construction.
      includeSuperadminRole: !!spec.isPlatform,
      includeDerivedUsers: false,
      modules: options.modules,
    })

    const { tenantId, organizationId } = setupResult
    const users: DevSeedTenantResult['users'] = [{
      email: primary.email,
      roles: primary.roles,
      created: setupResult.users.some((entry) => entry.created),
    }]

    for (const extra of rest) {
      const { created } = await ensureTenantUser(em, {
        email: extra.email,
        roles: extra.roles,
        tenantId,
        organizationId,
        passwordHash,
        name: extra.name,
        confirm: true,
      })
      users.push({ email: extra.email, roles: extra.roles, created })
    }

    const { created, existing } = await tenantModules.provisionTenant(tenantId)
    for (const moduleId of spec.withheldModules ?? []) {
      await tenantModules.setModuleEnabled(tenantId, moduleId, false)
    }

    results.push({
      name: spec.name,
      slug: spec.slug,
      tenantId,
      organizationId,
      isPlatform: !!spec.isPlatform,
      users,
      modulesGranted: created.length + existing.length - (spec.withheldModules?.length ?? 0),
      modulesWithheld: [...(spec.withheldModules ?? [])],
    })

    logger.info('Seeded development tenant', {
      tenant: spec.name,
      tenantId,
      users: users.length,
      withheld: spec.withheldModules?.length ?? 0,
    })
  }

  return { password, passwordFromEnv: fromEnv, tenants: results }
}
