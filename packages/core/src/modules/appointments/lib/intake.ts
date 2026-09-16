import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOrCreatePersonForIntake } from '@open-mercato/core/modules/customers/lib/personLookup'
import {
  listBookableServicesForOrganization,
  type BookableServiceDeps,
} from '@open-mercato/core/modules/catalog/lib/bookableServices'
import { Appointment, AppointmentLine, AppointmentStatus } from '../data/entities'
import { ResourcesAssignment } from '@open-mercato/core/modules/resources/data/entities'
import { DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE } from '../data/constants'
import { ensureSystemAppointmentStatuses } from '../setup'
import type { AppointmentPublicCreateInput, AppointmentStaffCreateInput } from '../data/validators'
import { toAppointmentPhoneSnapshot } from './phoneSnapshot'
import { snapshotLineOptions, deleteLineOptionSnapshots } from './lineOptionSnapshot'
import { checkPersonIdentity, type PersonCheckResult } from '@open-mercato/core/modules/customers/lib/personLookup'

type StaffEditDeps = BookableServiceDeps & {
  commandBus?: CommandBus
  commandContext?: CommandRuntimeContext
}

export type CreatedAppointmentResult = {
  id: string
  statusCode: string
  customerEntityId: string
  customerCreated: boolean
  requestedStartAt: string
  requestedEndAt: string | null
  lineCount: number
}

export type PublicCustomerLookupResult = Omit<PersonCheckResult, 'lastBooking'> & {
  lastBooking: {
    organizationId: string
    requestedStartAt: string
    serviceLines: Array<{
      productId: string
      selectedOptions: Record<string, unknown> | Record<string, unknown>[] | null
    }>
  } | null
}

export async function lookupPublicCustomerForAppointment(
  em: EntityManager,
  input: {
    tenantId: string
    phone: string
    email: string
    phoneCountryCode?: string | null
    phoneCountry?: string | null
  },
): Promise<PublicCustomerLookupResult> {
  const identity = await checkPersonIdentity(em, { tenantId: input.tenantId }, input)
  if (!identity.exists || !identity.customer) {
    return { exists: false, customer: null, lastBooking: null }
  }

  const appointment = await em.findOne(
    Appointment,
    {
      tenantId: input.tenantId,
      customerEntityId: identity.customer.id,
      deletedAt: null,
    },
    {
      orderBy: { requestedStartAt: 'DESC' },
      populate: ['lines'],
    },
  )

  return {
    ...identity,
    lastBooking: appointment
      ? {
          organizationId: appointment.organizationId,
          requestedStartAt: appointment.requestedStartAt.toISOString(),
          serviceLines: appointment.lines
            .getItems()
            .filter((line) => !line.deletedAt)
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((line) => ({
              productId: line.productId,
              selectedOptions: line.selectedOptions ?? null,
            })),
        }
      : null,
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort((left, right) => left.localeCompare(right)).map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function createAppointmentFromPublicIntake(
  em: EntityManager,
  input: AppointmentPublicCreateInput & { statusCode?: string },
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
    code: input.statusCode ?? DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE,
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
  input: AppointmentStaffCreateInput & { tenantId: string; organizationId: string },
  deps: StaffEditDeps,
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

  const oldOrganizationId = appointment.organizationId
  const oldRequestedStartAt = appointment.requestedStartAt
  const oldLines = await em.find(AppointmentLine, { appointment: appointment.id, deletedAt: null })
  const oldLineIds = oldLines.map((line) => line.id)
  const oldAssignments = oldLineIds.length > 0
    ? await em.find(ResourcesAssignment, {
        tenantId: input.tenantId,
        organizationId: { $in: Array.from(new Set([oldOrganizationId, input.organizationId])) },
        sourceModule: 'appointment',
        sourceEntityType: 'appointment_line',
        sourceEntityId: { $in: oldLineIds },
        cancelledAt: null,
      })
    : []
  const assignmentsByLineId = new Map<string, ResourcesAssignment[]>()
  for (const assignment of oldAssignments) {
    assignmentsByLineId.set(assignment.sourceEntityId, [
      ...(assignmentsByLineId.get(assignment.sourceEntityId) ?? []),
      assignment,
    ])
  }
  const oldDate = oldRequestedStartAt.toISOString().slice(0, 10)
  const nextDate = requestedStartAt.toISOString().slice(0, 10)
  const locationChanged = oldOrganizationId !== input.organizationId
  const usedLineIds = new Set<string>()
  const now = new Date()

  const cancelAssignments = (lineId: string) => {
    for (const assignment of assignmentsByLineId.get(lineId) ?? []) {
      assignment.cancelledAt = now
      assignment.updatedAt = now
    }
  }

  const findMatchingLine = (productId: string, selectedOptions: Record<string, unknown> | undefined) => {
    const serializedOptions = stableSerialize(selectedOptions ?? {})
    return oldLines.find((line) => {
      if (usedLineIds.has(line.id) || line.productId !== productId) return false
      return stableSerialize(line.selectedOptions ?? {}) === serializedOptions
    })
  }

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

  for (const line of resolvedLines) {
    const existingLine = findMatchingLine(line.service.id, line.selectedOptions)
    if (existingLine) {
      usedLineIds.add(existingLine.id)
      const assignmentInvalid = locationChanged
        || oldDate !== nextDate
        || existingLine.durationMinutes !== line.service.durationMinutes
        || (assignmentsByLineId.get(existingLine.id) ?? []).some((assignment) => assignment.startsAt < requestedStartAt)
      if (assignmentInvalid) cancelAssignments(existingLine.id)
      existingLine.organizationId = input.organizationId
      existingLine.productTitle = line.service.title
      existingLine.productHandle = line.service.handle
      existingLine.currencyCode = line.service.currencyCode
      existingLine.unitPriceNet = line.service.unitPriceNet
      existingLine.unitPriceGross = line.service.unitPriceGross
      existingLine.durationMinutes = line.service.durationMinutes
      existingLine.productCategory = line.service.categoryName
      existingLine.sortOrder = line.sortOrder
      continue
    }

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

    await snapshotLineOptions(em, lineEntity, { selectedOptions: line.selectedOptions })
  }

  for (const line of oldLines) {
    if (usedLineIds.has(line.id)) continue
    cancelAssignments(line.id)
    await deleteLineOptionSnapshots(em, line.id)
    line.deletedAt = now
  }

  await em.flush()

  if (
    input.updateCustomerProfile
    && person.entityId === appointment.customerEntityId
    && deps.commandBus
    && deps.commandContext
  ) {
    await deps.commandBus.execute('customers.people.update', {
      input: {
        id: person.entityId,
        displayName: customerName,
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        salutation: input.customer.salutation ?? null,
        primaryEmail: input.customer.email ?? null,
        primaryPhone: input.customer.phone,
        phoneCountryCode: phoneSnapshot?.customerPhoneCountryCode ?? input.customer.phoneCountryCode ?? null,
        phoneCountry: input.customer.phoneCountry ?? null,
        source: input.customer.source,
        origin: input.customer.origin,
        ...(input.customerUpdatedAt ? { expectedUpdatedAt: input.customerUpdatedAt } : {}),
      },
      ctx: deps.commandContext,
    })
  }

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
