const fieldByCustomerPath: Record<string, string> = {
  firstName: 'name',
  lastName: 'name',
  phone: 'phone',
  phoneCountryCode: 'phone',
  phoneCountry: 'phone',
  email: 'email',
  source: 'referral',
  origin: 'origin',
}

function fieldsForPath(path: unknown[]): string[] {
  const [root, child] = path
  if (root === 'customer' && typeof child === 'string') {
    const field = fieldByCustomerPath[child]
    return field ? [field] : []
  }
  if (root === 'requestedStartAt') return ['date', 'time']
  if (root === 'bookingType') return ['bookingType']
  if (root === 'organizationId') return ['location']
  if (root === 'lines') return ['serviceSelections']
  return []
}

export function mapAppointmentCreateValidationIssues(issues: unknown): Record<string, string> {
  if (!Array.isArray(issues)) return {}
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue
    const path = (issue as { path?: unknown }).path
    const message = (issue as { message?: unknown }).message
    if (!Array.isArray(path) || typeof message !== 'string' || !message.trim()) continue
    for (const field of fieldsForPath(path)) {
      if (!fieldErrors[field]) fieldErrors[field] = message
    }
  }
  return fieldErrors
}
