import {
  buildAppointmentRequestBody,
  composePhoneForField,
  joinPhoneWithDialCode,
  normalizeTimeValue,
  validateAppointmentForm,
  type AppointmentFormValues,
} from '../appointmentFormHelpers'

const t = ((key: string) => key) as Parameters<typeof validateAppointmentForm>[1]['t']

const values: AppointmentFormValues = {
  phone: '+84 912 345 678',
  email: ' ada@example.com ',
  salutation: 'Ms',
  name: '  Ada   Nguyen ',
  origin: 'walk_in',
  referral: 'google',
  location: 'org-2',
  bookingType: 'standard',
  date: '2026-10-01',
  time: '10:30:45',
  notes: ' Bring photos ',
  externalNotes: '',
  serviceSelections: [{ productId: 'svc-1', selectedOptions: { length: 'short' } }],
}

function validate(overrides: Partial<AppointmentFormValues>, attachFieldErrors = true, locationId: string | null = 'org-1') {
  return validateAppointmentForm({ ...values, ...overrides }, { tenantId: 'tenant-1', locationId, t, attachFieldErrors })
}

function failureOf(run: () => unknown) {
  try {
    run()
  } catch (error) {
    const failure = error as Error & { fieldErrors?: Record<string, string> }
    return { message: failure.message, fieldErrors: failure.fieldErrors }
  }
  throw new Error('expected a validation failure')
}

describe('appointment form phone helpers', () => {
  it('composes a stored phone with a "+" dial code for the phone field', () => {
    expect(composePhoneForField('912345678', '84')).toBe('+84 912345678')
    expect(composePhoneForField('912345678', '+84')).toBe('+84 912345678')
    expect(composePhoneForField(' +84 912 ', '84')).toBe('+84 912')
    expect(composePhoneForField('912', null)).toBe('912')
    expect(composePhoneForField('  ', '84')).toBe('')
  })

  it('joins the edit form pick without adding a "+"', () => {
    expect(joinPhoneWithDialCode('912345678', '84')).toBe('84 912345678')
    expect(joinPhoneWithDialCode(' +84 912 ', '84')).toBe('+84 912')
    expect(joinPhoneWithDialCode('912', ' ')).toBe('912')
    expect(joinPhoneWithDialCode(null, '84')).toBe('')
  })

  it('keeps hours and minutes of a picker time', () => {
    expect(normalizeTimeValue('10:30')).toBe('10:30')
    expect(normalizeTimeValue(' 10:30:45 ')).toBe('10:30')
    expect(normalizeTimeValue('25:00')).toBeNull()
    expect(normalizeTimeValue(undefined)).toBeNull()
  })
})

describe('validateAppointmentForm', () => {
  it('returns the write inputs for valid values', () => {
    const validated = validate({})
    expect(validated).toEqual({
      organizationId: 'org-2',
      requestedStartAt: new Date('2026-10-01T10:30:00').toISOString(),
      firstName: 'Ada',
      lastName: 'Nguyen',
      salutation: 'Ms',
      phoneIdentity: expect.objectContaining({ primaryPhone: '+84 912 345 678', phoneCountryCode: '84', phoneCountry: 'VN' }),
      serviceSelections: values.serviceSelections,
    })
  })

  it('falls back to the selected location and drops the "None" salutation', () => {
    const validated = validate({ location: '  ', salutation: 'None' })
    expect(validated.organizationId).toBe('org-1')
    expect(validated.salutation).toBeNull()
  })

  it('checks in order and marks the failing field when asked to', () => {
    expect(failureOf(() => validate({ name: ' ', origin: '' }))).toEqual({
      message: 'appointments.create.error.name',
      fieldErrors: { name: 'appointments.create.error.name' },
    })
    expect(failureOf(() => validate({ location: '' }, true, null))).toEqual({
      message: 'appointments.create.error.scope',
      fieldErrors: { location: 'appointments.create.error.scope' },
    })
    expect(failureOf(() => validate({ date: '' })).fieldErrors).toEqual({ date: 'appointments.create.error.datetime' })
    expect(failureOf(() => validate({ time: '24:00' })).fieldErrors).toEqual({ time: 'appointments.create.error.datetime' })
    expect(failureOf(() => validate({ serviceSelections: [] })).fieldErrors).toEqual({
      serviceSelections: 'appointments.create.error.servicesRequired',
    })
    expect(failureOf(() => validate({ phone: '12' })).fieldErrors).toEqual({ phone: 'appointments.create.field.phone.invalid' })
  })

  it('keeps failures form-level without field errors', () => {
    expect(failureOf(() => validate({ referral: '' }, false))).toEqual({
      message: 'appointments.create.error.referral',
      fieldErrors: undefined,
    })
    expect(failureOf(() => validate({ time: '' }, false))).toEqual({
      message: 'appointments.create.error.datetime',
      fieldErrors: undefined,
    })
  })

  it('lets an unparseable date surface as the RangeError it raises', () => {
    expect(() => validate({ date: 'not-a-date' })).toThrow(RangeError)
  })
})

describe('buildAppointmentRequestBody', () => {
  it('writes the visit, then any extra fields, then the customer and lines', () => {
    const validated = validate({})
    const body = buildAppointmentRequestBody(values, validated, { updateCustomerProfile: true, customerUpdatedAt: 'stamp' })
    expect(Object.keys(body)).toEqual([
      'organizationId',
      'requestedStartAt',
      'notes',
      'externalNotes',
      'bookingType',
      'updateCustomerProfile',
      'customerUpdatedAt',
      'customer',
      'lines',
    ])
    expect(body).toMatchObject({
      notes: 'Bring photos',
      externalNotes: null,
      customer: {
        firstName: 'Ada',
        lastName: 'Nguyen',
        phone: '+84 912 345 678',
        email: 'ada@example.com',
        salutation: 'Ms',
        source: 'google',
        origin: 'walk_in',
        phoneCountryCode: '84',
        phoneCountry: 'VN',
      },
      lines: [{ productId: 'svc-1', selectedOptions: { length: 'short' } }],
    })
  })

  it('writes no extra keys by default', () => {
    const body = buildAppointmentRequestBody({ ...values, email: ' ' }, validate({}))
    expect(Object.keys(body)).not.toContain('updateCustomerProfile')
    expect(body.customer.email).toBeNull()
  })
})
