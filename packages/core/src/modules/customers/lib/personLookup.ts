import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '../data/entities'
import { resolvePhoneIdentity } from './phoneIdentity'

export type PersonCheckCustomer = {
  id: string
  name: string
  salutation: string | null
  email: string | null
  phone: string | null
  phoneCountryCode: string | null
  phoneCountry: string | null
  source: string | null
}

export type PersonCheckResult = {
  exists: boolean
  customer: PersonCheckCustomer | null
  lastBooking: null
}

export type PersonLookupScope = {
  tenantId: string
  organizationId: string
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length ? trimmed : null
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
  scope: PersonLookupScope,
  email: string,
): Promise<{ entity: CustomerEntity; profile: CustomerPersonProfile | null } | null> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null

  const qb = em.createQueryBuilder(CustomerEntity, 'person')
  qb.select(['person.id'])
  qb.where({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
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

export async function assertBookingPersonScope(
  em: EntityManager,
  scope: PersonLookupScope,
): Promise<void> {
  const tenant = await em.findOne(Tenant, { id: scope.tenantId, isActive: true, deletedAt: null })
  if (!tenant) {
    throw new CrudHttpError(404, { error: 'Tenant not found.', code: 'TENANT_NOT_FOUND' })
  }

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
  scope: PersonLookupScope,
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
    organizationId: scope.organizationId,
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
  scope: PersonLookupScope,
  input: { phone?: string | null; email?: string | null; phoneCountryCode?: string | null; phoneCountry?: string | null },
): Promise<PersonCheckResult> {
  await assertBookingPersonScope(em, scope)

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

  const existingCheck = await checkPersonIdentity(em, input, {
    phone: input.phone,
    email: input.email,
    phoneCountryCode: input.phoneCountryCode,
    phoneCountry: input.phoneCountry,
  })
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
