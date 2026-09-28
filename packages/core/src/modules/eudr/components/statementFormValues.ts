import type { ReferencedStatementValue } from './formConfig'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

export function normalizeReferencedStatements(value: unknown): ReferencedStatementValue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
      const record = entry as Record<string, unknown>
      const referenceNumber = normalizeOptionalString(record.referenceNumber)
      if (!referenceNumber) return null
      const verificationNumber = normalizeOptionalString(record.verificationNumber)
      return verificationNumber ? { referenceNumber, verificationNumber } : { referenceNumber }
    })
    .filter((entry): entry is ReferencedStatementValue => entry !== null)
}

export function optionalSupplementaryNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = normalizeOptionalString(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.statements.form.supplementaryQuantityInvalid')
    throw createCrudFormError(message, { supplementaryQuantity: message })
  }
  return parsedNumber
}

export function optionalNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = normalizeOptionalString(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.statements.form.quantityKgInvalid')
    throw createCrudFormError(message, { quantityKg: message })
  }
  return parsedNumber
}
