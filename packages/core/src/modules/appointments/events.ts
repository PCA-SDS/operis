import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'appointments.appointment.created', label: 'Appointment Created', entity: 'appointment', category: 'crud', clientBroadcast: true },
  { id: 'appointments.appointment.updated', label: 'Appointment Updated', entity: 'appointment', category: 'crud', clientBroadcast: true },
  { id: 'appointments.appointment.deleted', label: 'Appointment Deleted', entity: 'appointment', category: 'crud', clientBroadcast: true },
  { id: 'appointments.appointment.draft_updated', label: 'Appointment Draft Updated', entity: 'appointment', category: 'crud', clientBroadcast: true },
  { id: 'appointments.appointment.schedule_confirmed', label: 'Appointment Schedule Confirmed', entity: 'appointment', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'appointments',
  events,
})

export const emitAppointmentEvent = eventsConfig.emit

export type AppointmentEventId = (typeof events)[number]['id']

export default eventsConfig
