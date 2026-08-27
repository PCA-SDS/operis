/**
 * Splits a single display name into CRM first/last for find-or-create intake.
 * One token → lastName is "-"; empty → both empty strings (caller validates).
 */
export function splitCustomerName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim().replace(/\s+/g, ' ')
  if (!trimmed) return { firstName: '', lastName: '' }
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex < 0) {
    return { firstName: trimmed, lastName: '-' }
  }
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim() || '-',
  }
}

/** Privé-style list label: `Mr. Ada Lovelace` (skips empty / `None` salutation). */
export function formatCustomerDisplayName(
  salutation: string | null | undefined,
  customerName: string,
): string {
  const name = customerName.trim().replace(/\s+/g, ' ')
  const sal = typeof salutation === 'string' ? salutation.trim() : ''
  if (!sal || sal === 'None') return name
  return `${sal}. ${name}`
}

export { formatCustomerPhone } from './phoneSnapshot'
