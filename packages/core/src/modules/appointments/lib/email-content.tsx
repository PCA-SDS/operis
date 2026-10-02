import type { ReactElement } from 'react'
import AppointmentNoti from '../emails/AppointmentNoti'
import AppointmentConfirmationEmail from '../emails/AppointmentConfirmationEmail'
import { CustomAppointmentConfirmationEmail, CustomAppointmentNoti } from '../emails/CustomAppointmentEmails'
import type { AppointmentEmailData } from '../emails/appointment-email'
import type { AppointmentEmailSettings } from './email-settings'

export type AppointmentEmailContent = {
  internal: { subject: string; react: ReactElement }
  customer: { subject: string; react: ReactElement }
}

export function buildAppointmentEmailContent(
  data: AppointmentEmailData,
  settings: AppointmentEmailSettings,
): AppointmentEmailContent {
  if (settings.templateMode === 'custom') {
    return {
      internal: {
        subject: `${settings.customization.internalSubjectPrefix} ${data.salutation}. ${data.customerName} - ${data.location}`,
        react: CustomAppointmentNoti({ data, customization: settings.customization }),
      },
      customer: {
        subject: settings.customization.customerSubject,
        react: CustomAppointmentConfirmationEmail({ data, customization: settings.customization }),
      },
    }
  }

  return {
    internal: {
      subject: `[TPS][BR] from ${data.salutation}. ${data.customerName} - ${data.location}`,
      react: AppointmentNoti(data),
    },
    customer: {
      subject: 'Your booking has been recorded – The Privé Spa',
      react: AppointmentConfirmationEmail(data),
    },
  }
}

export const APPOINTMENT_EMAIL_PREVIEW_DATA: AppointmentEmailData = {
  customerName: 'Ruby Chou',
  customerEmail: 'ruby@example.com',
  customerPhone: '909 095 491',
  countryCode: '+84',
  location: 'Bến Thành',
  requestedStartAt: new Date('2026-10-20T02:30:00.000Z'),
  externalNotes: 'A quiet room, if available.',
  typeOfBooking: 'Booking Form',
  salutation: 'Ms',
  membership: 'none',
  serviceSelections: [
    {
      itemName: 'Signature Manicure',
      basePrice: 450_000,
      selectedOptionsDetails: [{ groupLabel: 'Nail Arts', optionName: 'Nail Art', price: { min: 55_000, max: 240_000 } }],
    },
  ],
}
