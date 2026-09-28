import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { isRecord } from '@open-mercato/shared/lib/guards'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'

export function normalizeCustomerOption(item: unknown, t: TranslateFn): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = normalizeOptionalString(item.id)
  if (!id) return null
  const label =
    normalizeOptionalString(item.label) ??
    normalizeOptionalString(item.displayName) ??
    normalizeOptionalString(item.display_name) ??
    normalizeOptionalString(item.name) ??
    t('warranty_claims.form.customerUnnamed', 'Unnamed customer')
  const email = normalizeOptionalString(item.primaryEmail) ?? normalizeOptionalString(item.primary_email)
  return { value: id, label: email ? `${label} (${email})` : label }
}
