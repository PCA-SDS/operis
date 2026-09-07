import { hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { extractPhoneDigits } from '@open-mercato/shared/lib/phone'

/**
 * `primary_phone` and `primary_email` are encrypted at rest (see
 * `customers/encryption.ts`) with a per-value random IV, so SQL can neither
 * compare them for equality nor enforce a unique index over them. The
 * repository's answer — used by `auth` for `email_hash` — is a peppered digest
 * column alongside the ciphertext; these are the customers equivalents.
 *
 * Contexts domain-separate the two digests so a value peppered for one column
 * can never collide with a hash written for the other.
 */
const PHONE_LOOKUP_CONTEXT = 'customers:customer_entity:primary_phone'
const EMAIL_LOOKUP_CONTEXT = 'customers:customer_entity:primary_email'

export type PhoneIdentityParts = {
  primaryPhone: string | null
  primaryPhoneHash: string | null
  phoneCountryCode: string | null
  phoneCountry: string | null
}

export function normalizeDialCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const digits = extractPhoneDigits(value)
  return digits.length ? digits : null
}

/** ISO 3166-1 alpha-2, upper-cased to match `PhoneCountry.iso2` in the UI. */
export function normalizePhoneCountry(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const letters = value.trim().toUpperCase().replace(/[^A-Z]/g, '')
  return letters.length === 2 ? letters : null
}

export function normalizePrimaryPhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/**
 * Hashing the digits only means `+65 9123 4567`, `+6591234567` and
 * `+65-9123-4567` collapse to one identity, matching how `lookupPhoneDuplicate`
 * already compares phone numbers on the client.
 */
export function computePhoneLookupHash(value: string | null | undefined): string | null {
  const digits = extractPhoneDigits(value)
  return digits.length ? hashForLookup(digits, PHONE_LOOKUP_CONTEXT) : null
}

/**
 * Hash candidates for reads, covering rows written before the keyed digest
 * format. Use in `$in` filters; see {@link lookupHashCandidates}.
 */
export function phoneLookupHashCandidates(value: string | null | undefined): string[] {
  const digits = extractPhoneDigits(value)
  return digits.length ? lookupHashCandidates(digits, PHONE_LOOKUP_CONTEXT) : []
}

/** `hashForLookup` already lower-cases and trims, so raw input is safe here. */
export function computeEmailLookupHash(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return hashForLookup(value, EMAIL_LOOKUP_CONTEXT)
}

export function emailLookupHashCandidates(value: string | null | undefined): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  return lookupHashCandidates(value, EMAIL_LOOKUP_CONTEXT)
}

export function resolvePhoneIdentity(input: {
  primaryPhone?: string | null
  phoneCountryCode?: string | null
  phoneCountry?: string | null
}): PhoneIdentityParts {
  const primaryPhone = normalizePrimaryPhone(input.primaryPhone)
  return {
    primaryPhone,
    primaryPhoneHash: computePhoneLookupHash(primaryPhone),
    phoneCountryCode: normalizeDialCode(input.phoneCountryCode),
    phoneCountry: normalizePhoneCountry(input.phoneCountry),
  }
}
