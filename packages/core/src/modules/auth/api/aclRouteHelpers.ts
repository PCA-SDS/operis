import { normalizeGrantFeatureList } from '@open-mercato/core/modules/auth/lib/grantChecks'

export function normalizeOrganizations(organizations: unknown): string[] | null {
  if (!Array.isArray(organizations)) return null
  return normalizeGrantFeatureList(organizations)
}

export function readId(record: Record<string, unknown> | null | undefined): string | null {
  const value = record?.id
  return typeof value === 'string' && value.length > 0 ? value : null
}
