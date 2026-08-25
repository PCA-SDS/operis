export const APPOINTMENT_SYSTEM_STATUS_CODES = ['new_request', 'in_progress', 'booked'] as const

export type AppointmentSystemStatusCode = (typeof APPOINTMENT_SYSTEM_STATUS_CODES)[number]

export const DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE: AppointmentSystemStatusCode = 'new_request'

export const SYSTEM_APPOINTMENT_STATUS_SEEDS = [
  {
    code: 'new_request' as const,
    label: 'New request',
    description: 'Newly received appointment request.',
    sortOrder: 0,
  },
  {
    code: 'in_progress' as const,
    label: 'In progress',
    description: 'Being prepared or confirmed.',
    sortOrder: 1,
  },
  {
    code: 'booked' as const,
    label: 'Booked',
    description: 'Confirmed on the schedule.',
    sortOrder: 2,
  },
] as const
