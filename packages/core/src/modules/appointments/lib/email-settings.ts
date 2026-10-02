import { z } from 'zod'
import { emailSchema } from '@open-mercato/shared/lib/validation'

export const APPOINTMENT_EMAIL_SETTINGS_MODULE_ID = 'appointments'
export const APPOINTMENT_EMAIL_SETTINGS_KEY = 'public_booking_email'

export const ORIGINAL_PRIVE_LOGO_URL = 'https://drive.google.com/thumbnail?id=1X40oxtRs2quWRC0hioI920sDs7smo9bc&sz=w1000'
export const ORIGINAL_PRIVE_BANNER_URL = 'https://res.cloudinary.com/dff8ir6kc/image/upload/v1773810194/1_ilxnnx.png'

const emailListSchema = z.string().trim().refine((value) => {
  if (!value) return true
  return value.split(',').every((email) => emailSchema().safeParse(email.trim()).success)
}, 'Enter valid email addresses separated by commas.')

const optionalUrlSchema = z.string().trim().url().or(z.literal(''))
const copySchema = z.string().trim().min(1).max(2_000)

export const appointmentEmailCustomizationSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoUrl: optionalUrlSchema,
  bannerUrl: optionalUrlSchema,
  contactPhone: z.string().trim().max(80),
  contactEmail: emailSchema().or(z.literal('')),
  dashboardUrl: optionalUrlSchema,
  internalSubjectPrefix: z.string().trim().min(1).max(160),
  customerSubject: z.string().trim().min(1).max(200),
  internalHeadline: copySchema,
  internalIntro: copySchema,
  internalPreparation: copySchema,
  internalCtaLabel: z.string().trim().min(1).max(80),
  internalFooter: copySchema,
  customerIntro: copySchema,
  customerPendingNotice: copySchema,
  healthSafetyTitle: z.string().trim().min(1).max(160),
  healthSafetyBody: copySchema,
  updateTitle: z.string().trim().min(1).max(160),
  updateBody: copySchema,
  closingText: copySchema,
  signatureText: copySchema,
  customerFooter: copySchema,
})

export type AppointmentEmailCustomization = z.infer<typeof appointmentEmailCustomizationSchema>

export const DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION: AppointmentEmailCustomization = {
  brandName: 'Privé Spa',
  accentColor: '#3d5a4a',
  logoUrl: ORIGINAL_PRIVE_LOGO_URL,
  bannerUrl: ORIGINAL_PRIVE_BANNER_URL,
  contactPhone: '+84 909 095 491',
  contactEmail: 'info@theprivespa.vn',
  dashboardUrl: 'https://prive-dashboard.web.app/bookings',
  internalSubjectPrefix: '[TPS][BR] from',
  customerSubject: 'Your booking has been recorded – The Privé Spa',
  internalHeadline: 'A Guest Is Waiting for Us',
  internalIntro: "We're happy to inform you that a new guest has just made a booking.",
  internalPreparation: 'Please review the details below and prepare a calm, refreshing experience for our guest.',
  internalCtaLabel: 'View in Dashboard →',
  internalFooter: 'This is an automated notification from Privé Spa Booking System',
  customerIntro: 'Thank you for choosing The Privé Spa. We have received your booking request.',
  customerPendingNotice: 'Please be advised that your appointment has not yet been confirmed. Our team will review your booking request and contact you shortly. Should a deposit be required, we will notify you accordingly. A confirmation email will be issued once the booking is finalized.',
  healthSafetyTitle: 'Important Notes (Health & Safety)',
  healthSafetyBody: 'To help us serve you safely and comfortably, please contact us as soon as possible if you have any relevant health conditions, allergies, pregnancy, skin sensitivity, recent treatments/medications, or any concerns that may affect the Services. If such information is not disclosed in advance, we may be unable to accommodate adjustments on-site, and The Privé Spa may not be responsible for outcomes arising from non-disclosure.',
  updateTitle: 'Need to Update Your Booking?',
  updateBody: 'If you need to adjust your service list, time, or any details, please contact us with your booking reference.',
  closingText: 'We look forward to welcoming you.',
  signatureText: 'Warm regards,\nThe Privé Spa Booking Team',
  customerFooter: 'This is an automated notification from the Privé Spa Booking System. Please do not reply to this email.',
}

export const appointmentEmailSettingsSchema = z.object({
  from: emailSchema({ allowDisplayName: true }).or(z.literal('')).default(''),
  to: emailListSchema.default(''),
  cc: emailListSchema.default(''),
  bcc: emailListSchema.default(''),
  replyTo: emailSchema().or(z.literal('')).default(''),
  templateMode: z.enum(['original_prive', 'custom']).default('original_prive'),
  customization: appointmentEmailCustomizationSchema.default(DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION),
})

export type AppointmentEmailSettings = z.infer<typeof appointmentEmailSettingsSchema>

export const DEFAULT_APPOINTMENT_EMAIL_SETTINGS: AppointmentEmailSettings = {
  from: '',
  to: '',
  cc: '',
  bcc: '',
  replyTo: '',
  templateMode: 'original_prive',
  customization: DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION,
}

export function normalizeAppointmentEmailSettings(value: unknown): AppointmentEmailSettings {
  const parsed = appointmentEmailSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_APPOINTMENT_EMAIL_SETTINGS
}
