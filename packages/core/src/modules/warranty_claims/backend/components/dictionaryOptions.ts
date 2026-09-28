import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { isRecord } from '@open-mercato/shared/lib/guards'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'

export function normalizeDictionaryOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const value = normalizeOptionalString(item.value)
  if (!value) return null
  return { value, label: normalizeOptionalString(item.label) ?? value }
}
