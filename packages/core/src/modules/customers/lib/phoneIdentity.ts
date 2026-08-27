import { extractPhoneDigits } from '@open-mercato/shared/lib/phone'

export type PhoneIdentityParts = {
  primaryPhone: string | null
  phoneCountryCode: string | null
  phoneCountry: string | null
}

export function normalizeDialCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const digits = extractPhoneDigits(trimmed.startsWith('+') ? trimmed : `+${trimmed}`)
  return digits.length ? digits : null
}

export function normalizePhoneCountry(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

export function normalizePrimaryPhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function resolvePhoneIdentity(input: {
  primaryPhone?: string | null
  phoneCountryCode?: string | null
  phoneCountry?: string | null
}): PhoneIdentityParts {
  return {
    primaryPhone: normalizePrimaryPhone(input.primaryPhone),
    phoneCountryCode: normalizeDialCode(input.phoneCountryCode),
    phoneCountry: normalizePhoneCountry(input.phoneCountry),
  }
}

export function phoneIdentityKey(phoneCountryCode: string | null, primaryPhone: string | null): string | null {
  if (!phoneCountryCode || !primaryPhone) return null
  return `${phoneCountryCode}:${primaryPhone}`
}
