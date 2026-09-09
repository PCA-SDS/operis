import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'appointments.appointment.created', label: 'Appointment Created', entity: 'appointment', category: 'crud' },
  { id: 'appointments.appointment.updated', label: 'Appointment Updated', entity: 'appointment', category: 'crud' },
  { id: 'appointments.appointment.deleted', label: 'Appointment Deleted', entity: 'appointment', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'appointments',
  events,
})

export const emitAppointmentEvent = eventsConfig.emit

export type AppointmentEventId = (typeof events)[number]['id']

export default eventsConfig
