import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

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

const fieldLabelKeyByField: Record<string, string> = {
  name: 'appointments.create.field.name',
  phone: 'appointments.create.field.phone',
  email: 'appointments.create.field.email',
  referral: 'appointments.create.field.referral',
  origin: 'appointments.create.field.origin',
  bookingType: 'appointments.create.field.bookingType',
  location: 'appointments.create.field.location',
  date: 'appointments.create.field.date',
  time: 'appointments.create.field.time',
  serviceSelections: 'appointments.create.field.services',
}

const requiredMessageKeyByField: Record<string, string> = {
  name: 'appointments.create.error.name',
  phone: 'appointments.create.field.phone.invalid',
  referral: 'appointments.create.error.referral',
  origin: 'appointments.create.error.origin',
  bookingType: 'appointments.create.error.bookingType',
  location: 'appointments.create.error.scope',
  date: 'appointments.create.error.datetime',
  time: 'appointments.create.error.datetime',
  serviceSelections: 'appointments.create.error.servicesRequired',
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

function translateIssue(field: string, issue: Record<string, unknown>, t: TranslateFn): string {
  if (field === 'date' || field === 'time') {
    return t('appointments.create.validation.datetime', 'Enter a valid date and time.')
  }

  const code = typeof issue.code === 'string' ? issue.code : null
  if (code === 'too_small' && typeof issue.minimum === 'number' && issue.minimum === 1) {
    const requiredKey = requiredMessageKeyByField[field]
    if (requiredKey) return t(requiredKey, 'This field is required.')
  }
  if (code === 'too_big' && typeof issue.maximum === 'number') {
    const fieldLabelKey = fieldLabelKeyByField[field]
    const fieldLabel = fieldLabelKey ? t(fieldLabelKey, field) : field
    return t(
      'appointments.create.validation.tooLong',
      '{{field}} must be {{max}} characters or fewer.',
      { field: fieldLabel, max: issue.maximum },
    )
  }
  if (field === 'phone') return t('appointments.create.field.phone.invalid', 'Enter a valid phone number.')
  const fieldLabelKey = fieldLabelKeyByField[field]
  const fieldLabel = fieldLabelKey ? t(fieldLabelKey, field) : field
  return t('appointments.create.validation.invalid', 'Enter a valid value for {{field}}.', { field: fieldLabel })
}

export function mapAppointmentCreateValidationIssues(issues: unknown, t: TranslateFn): Record<string, string> {
  if (!Array.isArray(issues)) return {}
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue
    const path = (issue as { path?: unknown }).path
    if (!Array.isArray(path)) continue
    for (const field of fieldsForPath(path)) {
      if (!fieldErrors[field]) fieldErrors[field] = translateIssue(field, issue as Record<string, unknown>, t)
    }
  }
  return fieldErrors
}
