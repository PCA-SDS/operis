import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '../data/entities'
import { computeEmailLookupHash, computePhoneLookupHash } from './contactIdentity'

const CONTACT_HASH_BATCH_SIZE = 200

export type ContactHashBackfillResult = {
  scanned: number
  updated: number
  /** Groups of person ids competing for the same phone number. */
  phoneConflicts: string[][]
}

/**
 * Populates the deterministic lookup columns for people created before they existed.
 *
 * Rows written before this migration carry NULL hashes, which makes them invisible
 * to the identity lookup behind the booking check. The hashes cannot be computed in
 * SQL because the source columns are encrypted, so rows are read back decrypted and
 * rewritten in batches.
 *
 * A phone whose hash is already claimed by another person in the tenant is left NULL
 * and reported: writing it would violate the tenant-unique phone index, and deciding
 * which record keeps the number is an operator call, not a migration's.
 */
export async function backfillContactHashes(
  em: EntityManager,
  { tenantId }: { tenantId: string },
): Promise<ContactHashBackfillResult> {
  const people = await findWithDecryption(
    em,
    CustomerEntity,
    { tenantId, kind: 'person', deletedAt: null },
    {},
    { tenantId },
  )

  const claimedPhoneHash = new Map<string, string>()
  for (const person of people) {
    if (person.primaryPhoneHash) claimedPhoneHash.set(person.primaryPhoneHash, person.id)
  }

  const conflicts = new Map<string, string[]>()
  let updated = 0
  let pending = 0

  for (const person of people) {
    let changed = false

    const emailHash = computeEmailLookupHash(person.primaryEmail)
    if (emailHash !== (person.primaryEmailHash ?? null)) {
      person.primaryEmailHash = emailHash
      changed = true
    }

    const phoneHash = computePhoneLookupHash(person.primaryPhone)
    if (phoneHash && phoneHash !== person.primaryPhoneHash) {
      const owner = claimedPhoneHash.get(phoneHash)
      if (owner && owner !== person.id) {
        const group = conflicts.get(phoneHash) ?? [owner]
        group.push(person.id)
        conflicts.set(phoneHash, group)
      } else {
        claimedPhoneHash.set(phoneHash, person.id)
        person.primaryPhoneHash = phoneHash
        changed = true
      }
    } else if (!phoneHash && person.primaryPhoneHash) {
      person.primaryPhoneHash = null
      changed = true
    }

    if (!changed) continue
    em.persist(person)
    updated += 1
    pending += 1
    if (pending >= CONTACT_HASH_BATCH_SIZE) {
      await em.flush()
      pending = 0
    }
  }

  if (pending > 0) await em.flush()

  return { scanned: people.length, updated, phoneConflicts: Array.from(conflicts.values()) }
}
