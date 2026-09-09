import { z } from 'zod'
import { emailSchema } from '@open-mercato/shared/lib/validation'

const uuid = () => z.string().uuid()

const clearableString = (max: number) =>
  z.preprocess((value) => {
    if (value === null || value === undefined) return null
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }, z.string().max(max).nullable().optional())

const appointmentCustomerSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  // Deliberately format-free: `phoneCountryCode` is carried separately, so this
  // holds a national number without a `+` and would fail an E.164 check.
  phone: z.string().trim().min(1).max(50),
  // This is an unauthenticated booking endpoint and had no format check at all.
  email: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value
      const trimmed = value.trim()
      return trimmed.length ? trimmed : null
    },
    emailSchema({ maxLength: 255 }).nullable().optional(),
  ),
  salutation: clearableString(150),
  source: clearableString(150),
  phoneCountryCode: clearableString(8),
  phoneCountry: clearableString(120),
})

const appointmentLinesSchema = z
  .array(
    z.object({
      productId: uuid(),
    }),
  )
  .min(1)
  .max(20)

export const appointmentPublicCreateSchema = z.object({
  tenantId: uuid(),
  organizationId: uuid(),
  requestedStartAt: z.string().datetime({ offset: true }),
  notes: clearableString(2000),
  customer: appointmentCustomerSchema,
  lines: appointmentLinesSchema,
})

/** Staff create: tenant/org come from auth, not the body. */
export const appointmentStaffCreateSchema = z.object({
  requestedStartAt: z.string().datetime({ offset: true }),
  notes: clearableString(2000),
  customer: appointmentCustomerSchema,
  lines: appointmentLinesSchema,
})

export const appointmentStatusUpdateSchema = z.object({
  statusCode: z.string().trim().min(1).max(64),
})

export type AppointmentPublicCreateInput = z.infer<typeof appointmentPublicCreateSchema>
export type AppointmentStaffCreateInput = z.infer<typeof appointmentStaffCreateSchema>
export type AppointmentStatusUpdateInput = z.infer<typeof appointmentStatusUpdateSchema>
