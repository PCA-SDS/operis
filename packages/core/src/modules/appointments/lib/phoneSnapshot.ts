import { normalizeDialCode } from '@open-mercato/core/modules/customers/lib/phoneIdentity'

export type AppointmentPhoneSnapshot = {
  /** National / local number only (Privé `customerPhone`). */
  customerPhone: string
  /** Dial with leading `+` (Privé `phoneCountryCode`, e.g. `+84`). */
  customerPhoneCountryCode: string
}

function withPlusDial(dialDigits: string): string {
  return dialDigits.startsWith('+') ? dialDigits : `+${dialDigits}`
}

/**
 * Normalize appointment phone storage to the Privé booking shape:
 * - `customerPhoneCountryCode`: `+84`
 * - `customerPhone`: national number only (no country code)
 *
 * Only strip the dial when `phone` is a full international value (`+…`).
 * Do not strip dial digits from national numbers — VN mobiles can start with
 * `84…` while the country code is also `84`.
 *
 * CRM still receives the full international phone separately; this is only the
 * appointment snapshot used for list/detail display (`${code} ${phone}`).
 */
export function toAppointmentPhoneSnapshot(
  phone: string | null | undefined,
  phoneCountryCode?: string | null,
): AppointmentPhoneSnapshot | null {
  const raw = typeof phone === 'string' ? phone.trim().replace(/\s+/g, ' ') : ''
  if (!raw) return null

  const dialDigits = normalizeDialCode(phoneCountryCode)
  const dialWithPlus = dialDigits ? withPlusDial(dialDigits) : ''

  if (!raw.startsWith('+')) {
    return {
      customerPhone: raw,
      customerPhoneCountryCode: dialWithPlus,
    }
  }

  if (!dialDigits) {
    return { customerPhone: raw, customerPhoneCountryCode: '' }
  }

  const withoutPlus = raw.slice(1).trim()
  const compact = withoutPlus.replace(/\s+/g, '')
  if (!compact.startsWith(dialDigits)) {
    return { customerPhone: raw, customerPhoneCountryCode: dialWithPlus }
  }

  const spaced = new RegExp(`^${dialDigits}\\s*(.+)$`).exec(withoutPlus)
  const national = (spaced?.[1] ?? compact.slice(dialDigits.length)).trim()
  if (!national) {
    return { customerPhone: raw, customerPhoneCountryCode: dialWithPlus }
  }

  return { customerPhone: national, customerPhoneCountryCode: dialWithPlus }
}

/**
 * Privé contact label: `+84 842722728`.
 * Tolerates legacy rows where `customerPhone` already stored the full E.164 value.
 */
export function formatCustomerPhone(
  phoneCountryCode: string | null | undefined,
  customerPhone: string | null | undefined,
): string {
  const local = typeof customerPhone === 'string' ? customerPhone.trim() : ''
  if (!local) return ''
  // Legacy snapshot: full international already in customerPhone
  if (local.startsWith('+')) return local

  const dialDigits = normalizeDialCode(phoneCountryCode)
  if (!dialDigits) return local

  return `${withPlusDial(dialDigits)} ${local}`
}
