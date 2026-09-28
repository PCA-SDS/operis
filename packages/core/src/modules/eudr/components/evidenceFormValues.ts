import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

export function optionalNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = normalizeOptionalString(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.evidenceSubmissions.form.quantityKgInvalid')
    throw createCrudFormError(message, { quantityKg: message })
  }
  return parsedNumber
}

export function optionalUpperText(value: unknown): string | null {
  const text = normalizeOptionalString(value)
  return text ? text.toUpperCase() : null
}
