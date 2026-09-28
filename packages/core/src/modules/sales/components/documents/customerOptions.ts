export type CustomerOption = {
  id: string
  label: string
  subtitle?: string | null
  kind: 'person' | 'company'
  primaryEmail?: string | null
}

export function parseCustomerOptions(items: unknown[], kind: 'person' | 'company'): CustomerOption[] {
  const parsed: CustomerOption[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) continue
    const displayName =
      typeof record.display_name === 'string'
        ? record.display_name
        : typeof record.name === 'string'
          ? record.name
          : null
    const email = typeof record.primary_email === 'string' ? record.primary_email : null
    const domain = typeof record.primary_domain === 'string' ? record.primary_domain : null
    const label = displayName ?? (email ?? domain ?? id)
    const subtitle = kind === 'person' ? email : domain ?? email
    parsed.push({ id, label: `${label}`, subtitle, kind, primaryEmail: email })
  }
  return parsed
}
