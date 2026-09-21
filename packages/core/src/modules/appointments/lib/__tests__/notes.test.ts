import {
  getAppointmentSourceMarker,
  getVisibleAppointmentExternalNotes,
  preserveAppointmentSourceMarker,
} from '../notes'

describe('appointment external notes', () => {
  const marker = '[tps-booking-id:3157f4c2-7424-4b8c-af49-be78e2eeab9e]'

  it('hides the migration marker from visible notes', () => {
    expect(getVisibleAppointmentExternalNotes(`${marker}\nCustomer note`)).toBe('Customer note')
    expect(getAppointmentSourceMarker(`${marker}\nCustomer note`)).toBe(marker)
  })

  it('keeps the marker when editing visible notes', () => {
    expect(preserveAppointmentSourceMarker(`${marker}\nOld note`, 'New note')).toBe(`${marker}\nNew note`)
    expect(preserveAppointmentSourceMarker(`${marker}\nOld note`, '')).toBe(marker)
  })

  it('does not alter ordinary notes', () => {
    expect(getVisibleAppointmentExternalNotes('Customer note')).toBe('Customer note')
    expect(preserveAppointmentSourceMarker(null, 'Customer note')).toBe('Customer note')
  })
})
