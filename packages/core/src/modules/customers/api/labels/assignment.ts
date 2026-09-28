export function resolveRequiredFeature(kind: 'person' | 'company' | null | undefined): string {
  return kind === 'company' ? 'customers.companies.manage' : 'customers.people.manage'
}

export function resolveResourceKind(kind: 'person' | 'company' | null | undefined): string {
  if (kind === 'company') return 'customers.company'
  return 'customers.person'
}
