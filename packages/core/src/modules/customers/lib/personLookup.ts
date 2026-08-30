import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '../data/entities'
import { emailLookupHashCandidates, phoneLookupHashCandidates } from './contactIdentity'

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
