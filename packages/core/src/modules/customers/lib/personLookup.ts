import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '../data/entities'
import { resolvePhoneIdentity } from './contactIdentity'
import { normalizeEmail } from '@open-mercato/shared/lib/validation'

export type PersonSearchResult = {
  id: string
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
  phoneCountryCode: string | null
  phoneCountry: string | null
  salutation: string | null
  origin: string | null
  source: string | null
}

export type PersonCheckCustomer = {
  id: string
  name: string
  salutation: string | null
  email: string | null
  phone: string | null
  phoneCountryCode: string | null
  phoneCountry: string | null
  source: string | null
  origin: string | null
  organizationId: string
}

export type PersonCheckResult = {
  exists: boolean
  customer: PersonCheckCustomer | null
  lastBooking: null
}

export async function searchPeopleForBooking(
  em: EntityManager,
  scope: PersonTenantScope,
  search: string,
): Promise<PersonSearchResult[]> {
  const searchPattern = `%${search.trim().replace(/[%_]/g, '\\$&')}%`
  const entities = await findWithDecryption(
    em,
    CustomerEntity,
    {
      tenantId: scope.tenantId,
      kind: 'person',
      deletedAt: null,
      displayName: { $ilike: searchPattern },
    },
    { limit: 10, orderBy: { updatedAt: 'DESC' } },
    scope,
  )
  const profiles = await findWithDecryption(
    em,
    CustomerPersonProfile,
    { tenantId: scope.tenantId, entity: { $in: entities.map((entity) => entity.id) } },
    { populate: ['entity'] },
    scope,
  )
  const profilesByEntityId = new Map<string, CustomerPersonProfile>()
  profiles.forEach((profile) => {
    const entity = profile.entity as unknown as { id?: string } | undefined
    if (entity?.id) profilesByEntityId.set(entity.id, profile)
  })
  return entities.map((entity) => {
    const profile = profilesByEntityId.get(entity.id)
    return {
      id: entity.id,
      displayName: entity.displayName,
      primaryEmail: entity.primaryEmail ?? null,
      primaryPhone: entity.primaryPhone ?? null,
      phoneCountryCode: entity.phoneCountryCode ?? null,
      phoneCountry: entity.phoneCountry ?? null,
      salutation: profile?.salutation ?? null,
      origin: entity.origin ?? null,
      source: entity.source ?? null,
    }
  })
}

/** Tenant-wide identity lookup (customers are shared across branches/orgs). */
export type PersonTenantScope = {
  tenantId: string
}

/** Create still needs an organization_id row value (home org / booking branch). */
export type PersonLookupScope = PersonTenantScope & {
  organizationId: string
}

function mapPersonToCheckCustomer(
  entity: CustomerEntity,
  profile: CustomerPersonProfile | null,
): PersonCheckCustomer {
  return {
    id: entity.id,
    name: entity.displayName,
    salutation: profile?.salutation ?? null,
    email: entity.primaryEmail ?? null,
    phone: entity.primaryPhone ?? null,
    phoneCountryCode: entity.phoneCountryCode ?? null,
    phoneCountry: entity.phoneCountry ?? null,
    source: entity.source ?? null,
    origin: entity.origin ?? null,
    organizationId: entity.organizationId,
  }
}

async function loadPersonProfile(
  em: EntityManager,
  entityId: string,
): Promise<CustomerPersonProfile | null> {
  return findOneWithDecryption(em, CustomerPersonProfile, { entity: entityId })
}

export async function findPersonByEmail(
  em: EntityManager,
  scope: PersonTenantScope,
  email: string,
): Promise<{ entity: CustomerEntity; profile: CustomerPersonProfile | null } | null> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null

  const qb = em.createQueryBuilder(CustomerEntity, 'person')
  qb.select(['person.id'])
  qb.where({
    tenantId: scope.tenantId,
    kind: 'person',
    deletedAt: null,
  })
  qb.andWhere('lower(person.primary_email) = ?', [normalizedEmail])
  qb.limit(1)
  const match = await qb.getSingleResult()
  if (!match) return null

  const entity = await findOneWithDecryption(em, CustomerEntity, { id: match.id })
  if (!entity) return null
  const profile = await loadPersonProfile(em, entity.id)
  return { entity, profile }
}

export async function assertTenantActive(
  em: EntityManager,
  tenantId: string,
): Promise<void> {
  const tenant = await em.findOne(Tenant, { id: tenantId, isActive: true, deletedAt: null })
  if (!tenant) {
    throw new CrudHttpError(404, { error: 'Tenant not found.', code: 'TENANT_NOT_FOUND' })
  }
}

export async function assertBookingPersonScope(
  em: EntityManager,
  scope: PersonLookupScope,
): Promise<void> {
  await assertTenantActive(em, scope.tenantId)

  const organization = await em.findOne(Organization, {
    id: scope.organizationId,
    tenant: scope.tenantId,
    isActive: true,
    deletedAt: null,
  })
  if (!organization) {
    throw new CrudHttpError(404, { error: 'Organization not found.', code: 'ORGANIZATION_NOT_FOUND' })
  }
}

export async function findPersonByPhoneIdentity(
  em: EntityManager,
  scope: PersonTenantScope,
  phone: string,
  phoneCountryCode?: string | null,
  phoneCountry?: string | null,
): Promise<{ entity: CustomerEntity; profile: CustomerPersonProfile | null } | null> {
  const identity = resolvePhoneIdentity({
    primaryPhone: phone,
    phoneCountryCode,
    phoneCountry,
  })
  if (!identity.primaryPhone || !identity.phoneCountryCode) return null

  const entity = await findOneWithDecryption(em, CustomerEntity, {
    tenantId: scope.tenantId,
    kind: 'person',
    deletedAt: null,
    primaryPhone: identity.primaryPhone,
    phoneCountryCode: identity.phoneCountryCode,
  })
  if (!entity) return null
  const profile = await loadPersonProfile(em, entity.id)
  return { entity, profile }
}

export async function checkPersonIdentity(
  em: EntityManager,
  scope: PersonTenantScope,
  input: { phone?: string | null; email?: string | null; phoneCountryCode?: string | null; phoneCountry?: string | null },
): Promise<PersonCheckResult> {
  await assertTenantActive(em, scope.tenantId)

  const phoneInput = typeof input.phone === 'string' ? input.phone.trim() : ''
  const emailInput = typeof input.email === 'string' ? input.email.trim() : ''
  if (!phoneInput && !emailInput) {
    throw new CrudHttpError(400, {
      error: 'At least one of phone or email is required.',
      code: 'PHONE_OR_EMAIL_REQUIRED',
    })
  }

  const phoneMatch = phoneInput
    ? await findPersonByPhoneIdentity(em, scope, phoneInput, input.phoneCountryCode, input.phoneCountry)
    : null
  const emailMatch = emailInput ? await findPersonByEmail(em, scope, emailInput) : null

  if (phoneMatch && emailMatch && phoneMatch.entity.id !== emailMatch.entity.id) {
    throw new CrudHttpError(409, {
      error: 'Phone and email match different people.',
      code: 'PERSON_IDENTITY_CONFLICT',
    })
  }

  const match = phoneMatch ?? emailMatch
  if (!match) {
    return { exists: false, customer: null, lastBooking: null }
  }

  return {
    exists: true,
    customer: mapPersonToCheckCustomer(match.entity, match.profile),
    lastBooking: null,
  }
}

export type FindOrCreatePersonInput = PersonLookupScope & {
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  salutation?: string | null
  source?: string | null
  origin?: string | null
  phoneCountryCode?: string | null
  phoneCountry?: string | null
}

export type FindOrCreatePersonResult = {
  entityId: string
  personId: string
  created: boolean
}

export function mapErpClientStatusToOperis(status: string | null | undefined): {
  lifecycleStage: string | null
  status: string | null
} {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'active':
      return { lifecycleStage: 'customer', status: 'active' }
    case 'inactive':
      return { lifecycleStage: 'customer', status: 'inactive' }
    case 'blacklisted':
      return { lifecycleStage: 'customer', status: 'blacklisted' }
    case 'prospect':
    default:
      return { lifecycleStage: 'prospect', status: 'prospect' }
  }
}

export async function findOrCreatePersonForIntake(
  em: EntityManager,
  input: FindOrCreatePersonInput,
): Promise<FindOrCreatePersonResult> {
  await assertBookingPersonScope(em, input)

  const existingCheck = await checkPersonIdentity(
    em,
    { tenantId: input.tenantId },
    {
      phone: input.phone,
      email: input.email,
      phoneCountryCode: input.phoneCountryCode,
      phoneCountry: input.phoneCountry,
    },
  )
  if (existingCheck.exists && existingCheck.customer) {
    const profile = await loadPersonProfile(em, existingCheck.customer.id)
    return {
      entityId: existingCheck.customer.id,
      personId: profile?.id ?? existingCheck.customer.id,
      created: false,
    }
  }

  const phoneIdentity = resolvePhoneIdentity({
    primaryPhone: input.phone,
    phoneCountryCode: input.phoneCountryCode,
    phoneCountry: input.phoneCountry,
  })
  const { lifecycleStage, status } = mapErpClientStatusToOperis('prospect')
  const displayName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim()

  const entity = em.create(CustomerEntity, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    kind: 'person',
    displayName,
    primaryEmail: normalizeEmail(input.email),
    primaryPhone: phoneIdentity.primaryPhone,
    phoneCountryCode: phoneIdentity.phoneCountryCode,
    phoneCountry: phoneIdentity.phoneCountry,
    source: input.source?.trim() || null,
    origin: input.origin?.trim() || null,
    lifecycleStage,
    status,
    isActive: true,
  })
  const profile = em.create(CustomerPersonProfile, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    entity,
    salutation: input.salutation?.trim() || null,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    company: null,
  })
  em.persist(entity)
  em.persist(profile)
  await em.flush()

  return { entityId: entity.id, personId: profile.id, created: true }
}
