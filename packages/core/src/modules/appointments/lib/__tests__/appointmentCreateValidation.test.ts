import { mapAppointmentCreateValidationIssues } from '../appointmentCreateValidation'

describe('mapAppointmentCreateValidationIssues', () => {
  const translations: Record<string, string> = {
    'appointments.create.field.name': 'Name',
    'appointments.create.field.services': 'Services',
    'appointments.create.field.referral': 'Referral',
    'appointments.create.error.referral': 'Referral is required.',
  }
  const translate = (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => {
    const fallback = translations[key] ?? (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)
    const values = typeof fallbackOrParams === 'string' ? params : fallbackOrParams
    return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`))
  }

  it('maps nested customer name validation to the combined name field', () => {
    expect(mapAppointmentCreateValidationIssues([
      { path: ['customer', 'firstName'], code: 'too_big', maximum: 120 },
    ], translate)).toEqual({ name: 'Name must be 120 characters or fewer.' })
  })

  it('maps appointment payload paths to their create form fields', () => {
    expect(mapAppointmentCreateValidationIssues([
      { path: ['customer', 'source'], code: 'too_small', minimum: 1 },
      { path: ['requestedStartAt'], code: 'invalid_format' },
      { path: ['lines', 0, 'productId'], code: 'invalid_format' },
    ], translate)).toEqual({
      referral: 'Referral is required.',
      date: 'Enter a valid date and time.',
      time: 'Enter a valid date and time.',
      serviceSelections: 'Enter a valid value for Services.',
    })
  })

  it('does not expose raw backend issue messages', () => {
    expect(mapAppointmentCreateValidationIssues([
      { path: ['customer', 'firstName'], code: 'too_big', maximum: 120, message: 'Too big: expected string to have <=120 characters' },
    ], translate).name).not.toContain('Too big')
  })
})
