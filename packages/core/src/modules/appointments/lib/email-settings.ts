import { z } from 'zod'

export const APPOINTMENT_EMAIL_SETTINGS_MODULE_ID = 'appointments'
export const APPOINTMENT_EMAIL_SETTINGS_KEY = 'public_booking_email'

const emailListSchema = z.string().trim().refine((value) => {
  if (!value) return true
  return value.split(',').every((email) => z.string().email().safeParse(email.trim()).success)
}, 'Enter valid email addresses separated by commas.')

export const appointmentEmailSettingsSchema = z.object({
  from: z.string().trim().email().or(z.literal('')),
  to: emailListSchema,
  cc: emailListSchema,
  bcc: emailListSchema,
  replyTo: z.string().trim().email().or(z.literal('')),
})

export type AppointmentEmailSettings = z.infer<typeof appointmentEmailSettingsSchema>

export const DEFAULT_APPOINTMENT_EMAIL_SETTINGS: AppointmentEmailSettings = {
  from: '',
  to: '',
  cc: '',
  bcc: '',
  replyTo: '',
}
