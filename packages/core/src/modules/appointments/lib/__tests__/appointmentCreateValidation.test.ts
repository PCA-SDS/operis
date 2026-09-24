import { mapAppointmentCreateValidationIssues } from '../appointmentCreateValidation'

describe('mapAppointmentCreateValidationIssues', () => {
  it('maps nested customer name validation to the combined name field', () => {
    expect(mapAppointmentCreateValidationIssues([
      { path: ['customer', 'firstName'], message: 'Too big: expected string to have <=120 characters' },
    ])).toEqual({ name: 'Too big: expected string to have <=120 characters' })
  })

  it('maps appointment payload paths to their create form fields', () => {
    expect(mapAppointmentCreateValidationIssues([
      { path: ['customer', 'source'], message: 'Required' },
      { path: ['requestedStartAt'], message: 'Invalid datetime' },
      { path: ['lines', 0, 'productId'], message: 'Invalid UUID' },
    ])).toEqual({
      referral: 'Required',
      date: 'Invalid datetime',
      time: 'Invalid datetime',
      serviceSelections: 'Invalid UUID',
    })
  })
})
