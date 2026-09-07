import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '../data/entities'
import {
  computeEmailLookupHash,
  emailLookupHashCandidates,
  phoneLookupHashCandidates,
  resolvePhoneIdentity,
} from './contactIdentity'

/**
 * Existence only. This answers an unauthenticated caller, so it deliberately
 * carries no customer fields — a booking form learns whether to greet a
 * returning customer, and prefill stays behind a verified session.
 */
export type PersonCheckResult = {
  exists: boolean
}

/** Customers are shared across an account's branches, so lookup is tenant-wide. */
export type PersonTenantScope = {
  tenantId: string
}

export type PersonCheckInput = {
  phone?: string | null
  email?: string | null
}

/**
 * Resolves a person id from one of the deterministic contact hashes.
 *
 * Only `id` is selected: matching happens entirely on the hash columns, so no
 * ciphertext needs decrypting and no PII enters memory on this path.
 */
async function findPersonIdByHash(
  em: EntityManager,
  scope: PersonTenantScope,
  column: 'primaryPhoneHash' | 'primaryEmailHash',
  candidates: string[],
): Promise<string | null> {
  if (!candidates.length) return null
  const match = await em.findOne(
    CustomerEntity,
    {
      tenantId: scope.tenantId,
      kind: 'person',
      deletedAt: null,
      [column]: { $in: candidates },
    },
    { fields: ['id'] },
  )
  return match?.id ?? null
}

export async function checkPersonIdentity(
  em: EntityManager,
  scope: PersonTenantScope,
  input: PersonCheckInput,
): Promise<PersonCheckResult> {
  const phone = typeof input.phone === 'string' ? input.phone.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  if (!phone && !email) {
    throw new CrudHttpError(400, {
      error: 'At least one of phone or email is required.',
      code: 'PHONE_OR_EMAIL_REQUIRED',
    })
  }

  const [phoneMatchId, emailMatchId] = await Promise.all([
    findPersonIdByHash(em, scope, 'primaryPhoneHash', phoneLookupHashCandidates(phone)),
    findPersonIdByHash(em, scope, 'primaryEmailHash', emailLookupHashCandidates(email)),
  ])

  if (phoneMatchId && emailMatchId && phoneMatchId !== emailMatchId) {
    throw new CrudHttpError(409, {
      error: 'Phone and email match different people.',
      code: 'PERSON_IDENTITY_CONFLICT',
    })
  }

  return { exists: Boolean(phoneMatchId ?? emailMatchId) }
}

/** Create still needs an organization_id row value (home org / booking branch). */
export type PersonLookupScope = PersonTenantScope & {
  organizationId: string
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

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

async function assertTenantActive(em: EntityManager, tenantId: string): Promise<void> {
  const tenant = await em.findOne(Tenant, { id: tenantId, isActive: true, deletedAt: null })
  if (!tenant) {
    throw new CrudHttpError(404, { error: 'Tenant not found.', code: 'TENANT_NOT_FOUND' })
  }
}

async function assertBookingPersonScope(em: EntityManager, scope: PersonLookupScope): Promise<void> {
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

async function resolveExistingPersonIdForIntake(
  em: EntityManager,
  scope: PersonTenantScope,
  input: Pick<FindOrCreatePersonInput, 'phone' | 'email'>,
): Promise<string | null> {
  const phone = typeof input.phone === 'string' ? input.phone.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  if (!phone && !email) {
    throw new CrudHttpError(400, {
      error: 'At least one of phone or email is required.',
      code: 'PHONE_OR_EMAIL_REQUIRED',
    })
  }

  const [phoneMatchId, emailMatchId] = await Promise.all([
    findPersonIdByHash(em, scope, 'primaryPhoneHash', phoneLookupHashCandidates(phone)),
    findPersonIdByHash(em, scope, 'primaryEmailHash', emailLookupHashCandidates(email)),
  ])

  if (phoneMatchId && emailMatchId && phoneMatchId !== emailMatchId) {
    throw new CrudHttpError(409, {
      error: 'Phone and email match different people.',
      code: 'PERSON_IDENTITY_CONFLICT',
    })
  }

  return phoneMatchId ?? emailMatchId
}

export async function findOrCreatePersonForIntake(
  em: EntityManager,
  input: FindOrCreatePersonInput,
): Promise<FindOrCreatePersonResult> {
  await assertBookingPersonScope(em, input)

  const existingEntityId = await resolveExistingPersonIdForIntake(
    em,
    { tenantId: input.tenantId },
    { phone: input.phone, email: input.email },
  )
  if (existingEntityId) {
    const profile = await em.findOne(CustomerPersonProfile, {
      entity: existingEntityId,
      deletedAt: null,
    })
    return {
      entityId: existingEntityId,
      personId: profile?.id ?? existingEntityId,
      created: false,
    }
  }

  const phoneIdentity = resolvePhoneIdentity({
    primaryPhone: input.phone,
    phoneCountryCode: input.phoneCountryCode,
    phoneCountry: input.phoneCountry,
  })
  const primaryEmail = normalizeEmail(input.email)
  const displayName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim()

  const entity = em.create(CustomerEntity, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    kind: 'person',
    displayName,
    primaryEmail,
    primaryEmailHash: computeEmailLookupHash(primaryEmail),
    primaryPhone: phoneIdentity.primaryPhone,
    primaryPhoneHash: phoneIdentity.primaryPhoneHash,
    phoneCountryCode: phoneIdentity.phoneCountryCode,
    phoneCountry: phoneIdentity.phoneCountry,
    source: input.source?.trim() || null,
    lifecycleStage: 'prospect',
    status: 'prospect',
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
