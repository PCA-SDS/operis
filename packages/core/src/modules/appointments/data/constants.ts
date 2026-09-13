import { CUSTOMER_ORIGIN_OPTIONS, type CustomerOrigin } from '@open-mercato/core/modules/customers/data/constants'

export const APPOINTMENT_SYSTEM_STATUS_CODES = ['new_request', 'in_progress', 'booked', 'cancelled'] as const

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
  {
    code: 'cancelled' as const,
    label: 'Cancelled',
    description: 'Booking was cancelled.',
    sortOrder: 3,
  },
] as const

/** Mirrors TPS booking form option sets for staff create parity. */
export const APPOINTMENT_SALUTATION_OPTIONS = [
  { value: 'None', label: 'None' },
  { value: 'Mr', label: 'Mr.' },
  { value: 'Mrs', label: 'Mrs.' },
  { value: 'Ms', label: 'Ms.' },
  { value: 'Mx', label: 'Mx.' },
] as const

/** Prefer CUSTOMER_ORIGIN_OPTIONS — origin lives on CRM customer. */
export const APPOINTMENT_ORIGIN_OPTIONS = CUSTOMER_ORIGIN_OPTIONS
export type AppointmentOrigin = CustomerOrigin

export const APPOINTMENT_BOOKING_TYPE_OPTIONS = [
  { value: 'call_in', label: 'Call In' },
  { value: 'walk_in', label: 'Walk In' },
  { value: 'booking_form', label: 'Booking Form' },
  { value: 'meta', label: 'Meta' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'zalo', label: 'Zalo' },
] as const

export type AppointmentBookingType = (typeof APPOINTMENT_BOOKING_TYPE_OPTIONS)[number]['value']

export const APPOINTMENT_ORIGIN_CODES = CUSTOMER_ORIGIN_OPTIONS.map((option) => option.value) as [
  AppointmentOrigin,
  ...AppointmentOrigin[],
]

export const APPOINTMENT_BOOKING_TYPE_CODES = APPOINTMENT_BOOKING_TYPE_OPTIONS.map((option) => option.value) as [
  AppointmentBookingType,
  ...AppointmentBookingType[],
]
