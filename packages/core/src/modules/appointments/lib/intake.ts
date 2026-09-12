import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOrCreatePersonForIntake } from '@open-mercato/core/modules/customers/lib/personLookup'
import {
  listBookableServicesForOrganization,
  type BookableServiceDeps,
} from '@open-mercato/core/modules/catalog/lib/bookableServices'
import { Appointment, AppointmentLine, AppointmentStatus } from '../data/entities'
import { DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE } from '../data/constants'
import { ensureSystemAppointmentStatuses } from '../setup'
import type { AppointmentPublicCreateInput } from '../data/validators'
import { toAppointmentPhoneSnapshot } from './phoneSnapshot'
import { snapshotLineOptions, deleteLineOptionSnapshots } from './lineOptionSnapshot'

export type CreatedAppointmentResult = {
  id: string
  statusCode: string
  customerEntityId: string
  customerCreated: boolean
  requestedStartAt: string
  requestedEndAt: string | null
  lineCount: number
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export async function createAppointmentFromPublicIntake(
  em: EntityManager,
  input: AppointmentPublicCreateInput,
  deps: BookableServiceDeps,
): Promise<CreatedAppointmentResult> {
  const requestedStartAt = new Date(input.requestedStartAt)
  if (Number.isNaN(requestedStartAt.getTime())) {
    throw new CrudHttpError(400, { error: 'Invalid requestedStartAt.', code: 'INVALID_START_AT' })
  }

  const person = await findOrCreatePersonForIntake(em, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    firstName: input.customer.firstName,
    lastName: input.customer.lastName,
    phone: input.customer.phone,
    email: input.customer.email,
    salutation: input.customer.salutation,
    source: input.customer.source,
    origin: input.customer.origin,
    phoneCountryCode: input.customer.phoneCountryCode,
    phoneCountry: input.customer.phoneCountry,
  })

  const bookable = await listBookableServicesForOrganization(
    em,
    {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    deps,
  )
  const bookableById = new Map(bookable.map((service) => [service.id, service]))

  const resolvedLines = input.lines.map((line, index) => {
    const service = bookableById.get(line.productId)
    if (!service) {
      throw new CrudHttpError(400, {
        error: 'One or more services are not bookable for this organization.',
        code: 'SERVICE_NOT_BOOKABLE',
      })
    }
    return { service, sortOrder: index, selectedOptions: line.selectedOptions }
  })

  await ensureSystemAppointmentStatuses(em, input.tenantId)
  const status = await em.findOne(AppointmentStatus, {
    tenantId: input.tenantId,
    code: DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE,
    deletedAt: null,
  })
  if (!status) {
    throw new CrudHttpError(500, {
      error: 'Default appointment status is missing.',
      code: 'STATUS_MISSING',
    })
  }

  const totalDuration = resolvedLines.reduce(
    (sum, line) => sum + (line.service.durationMinutes ?? 0),
    0,
  )
  const requestedEndAt = totalDuration > 0 ? addMinutes(requestedStartAt, totalDuration) : null
  const customerName = `${input.customer.firstName.trim()} ${input.customer.lastName.trim()}`.trim()
  const phoneSnapshot = toAppointmentPhoneSnapshot(
    input.customer.phone,
    input.customer.phoneCountryCode,
  )

  const appointment = em.create(Appointment, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    customerEntityId: person.entityId,
    customerName,
    customerSalutation: input.customer.salutation ?? null,
    customerEmail: input.customer.email ?? null,
    customerPhone: phoneSnapshot?.customerPhone ?? input.customer.phone,
    customerPhoneCountryCode:
      phoneSnapshot?.customerPhoneCountryCode || input.customer.phoneCountryCode || null,
    customerPhoneCountry: input.customer.phoneCountry ?? null,
    customerOrigin: input.customer.origin,
    bookingType: input.bookingType,
    status,
    statusCode: status.code,
    requestedStartAt,
    requestedEndAt,
    notes: input.notes ?? null,
    externalNotes: input.externalNotes ?? null,
  })
  em.persist(appointment)

  for (const line of resolvedLines) {
    const lineEntity = em.create(AppointmentLine, {
      appointment,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      productId: line.service.id,
      productTitle: line.service.title,
      productHandle: line.service.handle,
      currencyCode: line.service.currencyCode,
      unitPriceNet: line.service.unitPriceNet,
      unitPriceGross: line.service.unitPriceGross,
      durationMinutes: line.service.durationMinutes,
      productCategory: line.service.categoryName,
      selectedOptions: line.selectedOptions,
      sortOrder: line.sortOrder,
    })
    em.persist(lineEntity)

    // Snapshot options from catalog for analytics and historical accuracy
    await snapshotLineOptions(em, lineEntity, { selectedOptions: line.selectedOptions })
  }

  await em.flush()

  return {
    id: appointment.id,
    statusCode: appointment.statusCode,
    customerEntityId: person.entityId,
    customerCreated: person.created,
    requestedStartAt: appointment.requestedStartAt.toISOString(),
    requestedEndAt: appointment.requestedEndAt?.toISOString() ?? null,
    lineCount: resolvedLines.length,
  }
}

export async function updateAppointmentFromStaffEdit(
  em: EntityManager,
  id: string,
  input: AppointmentPublicCreateInput,
  deps: BookableServiceDeps,
) {
  const appointment = await em.findOne(Appointment, { id, tenantId: input.tenantId, deletedAt: null })
  if (!appointment) {
    throw new CrudHttpError(404, { error: 'Appointment not found.', code: 'NOT_FOUND' })
  }

  const requestedStartAt = new Date(input.requestedStartAt)
  if (Number.isNaN(requestedStartAt.getTime())) {
    throw new CrudHttpError(400, {
      error: 'Invalid requestedStartAt.',
      code: 'INVALID_DATETIME',
    })
  }

  const person = await findOrCreatePersonForIntake(em, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    firstName: input.customer.firstName,
    lastName: input.customer.lastName,
    phone: input.customer.phone,
    email: input.customer.email,
    salutation: input.customer.salutation,
    source: input.customer.source,
    origin: input.customer.origin,
    phoneCountryCode: input.customer.phoneCountryCode,
    phoneCountry: input.customer.phoneCountry,
  })

  const bookable = await listBookableServicesForOrganization(
    em,
    {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    deps,
  )
  const bookableById = new Map(bookable.map((service) => [service.id, service]))

  const resolvedLines = input.lines.map((line, index) => {
    const service = bookableById.get(line.productId)
    if (!service) {
      throw new CrudHttpError(400, {
        error: 'One or more services are not bookable for this organization.',
        code: 'SERVICE_NOT_BOOKABLE',
      })
    }
    return { service, sortOrder: index, selectedOptions: line.selectedOptions }
  })

  const totalDuration = resolvedLines.reduce(
    (sum, line) => sum + (line.service.durationMinutes ?? 0),
    0,
  )
  const requestedEndAt = totalDuration > 0 ? addMinutes(requestedStartAt, totalDuration) : null
  const customerName = `${input.customer.firstName.trim()} ${input.customer.lastName.trim()}`.trim()
  const phoneSnapshot = toAppointmentPhoneSnapshot(
    input.customer.phone,
    input.customer.phoneCountryCode,
  )

  appointment.organizationId = input.organizationId
  appointment.customerEntityId = person.entityId
  appointment.customerName = customerName
  appointment.customerSalutation = input.customer.salutation ?? null
  appointment.customerEmail = input.customer.email ?? null
  appointment.customerPhone = phoneSnapshot?.customerPhone ?? input.customer.phone
  appointment.customerPhoneCountryCode = phoneSnapshot?.customerPhoneCountryCode || input.customer.phoneCountryCode || null
  appointment.customerPhoneCountry = input.customer.phoneCountry ?? null
  appointment.customerOrigin = input.customer.origin
  appointment.bookingType = input.bookingType
  appointment.requestedStartAt = requestedStartAt
  appointment.requestedEndAt = requestedEndAt
  appointment.notes = input.notes ?? null
  appointment.externalNotes = input.externalNotes ?? null
  appointment.updatedAt = new Date()

  // Replace lines
  const oldLines = await em.find(AppointmentLine, { appointment: appointment.id, deletedAt: null })

  // Delete option snapshots for old lines (cascade will handle FK cleanup, but explicit is clearer)
  for (const line of oldLines) {
    await deleteLineOptionSnapshots(em, line.id)
  }

  for (const line of oldLines) {
    line.deletedAt = new Date()
  }

  for (const line of resolvedLines) {
    const lineEntity = em.create(AppointmentLine, {
      appointment,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      productId: line.service.id,
      productTitle: line.service.title,
      productHandle: line.service.handle,
      currencyCode: line.service.currencyCode,
      unitPriceNet: line.service.unitPriceNet,
      unitPriceGross: line.service.unitPriceGross,
      durationMinutes: line.service.durationMinutes,
      productCategory: line.service.categoryName,
      selectedOptions: line.selectedOptions,
      sortOrder: line.sortOrder,
    })
    em.persist(lineEntity)

    // Snapshot options from catalog for analytics and historical accuracy
    await snapshotLineOptions(em, lineEntity, { selectedOptions: line.selectedOptions })
  }

  await em.flush()

  return {
    id: appointment.id,
    statusCode: appointment.statusCode,
    customerEntityId: person.entityId,
    customerCreated: person.created,
    requestedStartAt: appointment.requestedStartAt.toISOString(),
    requestedEndAt: appointment.requestedEndAt?.toISOString() ?? null,
    lineCount: resolvedLines.length,
  }
}

export async function addServiceToAppointment(
  em: EntityManager,
  params: {
    appointmentId: string
    tenantId: string
    organizationId: string
    productId: string
    selectedOptions?: Record<string, unknown>
  },
  deps: BookableServiceDeps,
): Promise<AppointmentLine> {
  const appointment = await em.findOne(Appointment, {
    id: params.appointmentId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  })
  if (!appointment) {
    throw new CrudHttpError(404, { error: 'Appointment not found.', code: 'NOT_FOUND' })
  }

  const bookable = await listBookableServicesForOrganization(
    em,
    { tenantId: params.tenantId, organizationId: appointment.organizationId },
    deps,
  )
  const service = bookable.find((entry) => entry.id === params.productId)
  if (!service) {
    throw new CrudHttpError(400, {
      error: 'One or more services are not bookable for this organization.',
      code: 'SERVICE_NOT_BOOKABLE',
    })
  }

  const existingLines = await em.find(
    AppointmentLine,
    { appointment: appointment.id, deletedAt: null },
    { orderBy: { sortOrder: 'desc' } },
  )
  if (existingLines.some((entry) => entry.productId === service.id)) {
    throw new CrudHttpError(409, {
      error: 'This service is already added to the appointment.',
      code: 'SERVICE_ALREADY_ADDED',
    })
  }
  const line = em.create(AppointmentLine, {
    appointment,
    tenantId: params.tenantId,
    organizationId: appointment.organizationId,
    productId: service.id,
    productTitle: service.title,
    productHandle: service.handle,
    currencyCode: service.currencyCode,
    unitPriceNet: service.unitPriceNet,
    unitPriceGross: service.unitPriceGross,
    durationMinutes: service.durationMinutes,
    productCategory: service.categoryName,
    selectedOptions: params.selectedOptions,
    sortOrder: (existingLines[0]?.sortOrder ?? -1) + 1,
  })
  em.persist(line)
  await snapshotLineOptions(em, line, { selectedOptions: params.selectedOptions })

  const totalDuration = existingLines.reduce(
    (sum, entry) => sum + (entry.durationMinutes ?? 0),
    0,
  ) + (line.durationMinutes ?? service.durationMinutes ?? 0)
  appointment.requestedEndAt = totalDuration > 0
    ? addMinutes(appointment.requestedStartAt, totalDuration)
    : null
  appointment.updatedAt = new Date()
  await em.flush()
  return line
}
