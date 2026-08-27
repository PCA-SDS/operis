import { z } from 'zod'
import { CUSTOMER_ORIGIN_CODES } from '@open-mercato/core/modules/customers/data/constants'
import { APPOINTMENT_BOOKING_TYPE_CODES } from './constants'

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
  phone: z.string().trim().min(1).max(50),
  email: clearableString(255),
  salutation: clearableString(150),
  /** Referral — CRM customer.source (tenant dictionary `sources`) */
  source: z.string().trim().min(1).max(150),
  /** TPS origin — CRM customer.origin */
  origin: z.enum(CUSTOMER_ORIGIN_CODES),
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

const appointmentCreateFieldsSchema = z.object({
  requestedStartAt: z.string().datetime({ offset: true }),
  notes: clearableString(2000),
  externalNotes: clearableString(2000),
  bookingType: z.enum(APPOINTMENT_BOOKING_TYPE_CODES),
  customer: appointmentCustomerSchema,
  lines: appointmentLinesSchema,
})

export const appointmentPublicCreateSchema = appointmentCreateFieldsSchema.extend({
  tenantId: uuid(),
  organizationId: uuid(),
})

/** Staff create: tenant from auth; organization from body or auth org. */
export const appointmentStaffCreateSchema = appointmentCreateFieldsSchema.extend({
  organizationId: uuid().optional(),
})

export const appointmentStatusUpdateSchema = z.object({
  statusCode: z.string().trim().min(1).max(64),
})

export const appointmentStatusCatalogCreateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(64).optional(),
  description: clearableString(500),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export const appointmentStatusCatalogUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: clearableString(500),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export type AppointmentPublicCreateInput = z.infer<typeof appointmentPublicCreateSchema>
export type AppointmentStaffCreateInput = z.infer<typeof appointmentStaffCreateSchema>
export type AppointmentStatusUpdateInput = z.infer<typeof appointmentStatusUpdateSchema>
export type AppointmentStatusCatalogCreateInput = z.infer<typeof appointmentStatusCatalogCreateSchema>
export type AppointmentStatusCatalogUpdateInput = z.infer<typeof appointmentStatusCatalogUpdateSchema>
