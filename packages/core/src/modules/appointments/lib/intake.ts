import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOrCreatePersonForIntake } from '@open-mercato/core/modules/customers/lib/personLookup'
import { listBookableServicesForOrganization } from '@open-mercato/core/modules/catalog/lib/bookableServices'
import { Appointment, AppointmentLine, AppointmentStatus } from '../data/entities'
import { DEFAULT_PUBLIC_APPOINTMENT_STATUS_CODE } from '../data/constants'
import { ensureSystemAppointmentStatuses } from '../setup'
import type { AppointmentPublicCreateInput } from '../data/validators'

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
    phoneCountryCode: input.customer.phoneCountryCode,
    phoneCountry: input.customer.phoneCountry,
  })

  const bookable = await listBookableServicesForOrganization(em, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
  const bookableById = new Map(bookable.map((service) => [service.id, service]))

  const resolvedLines = input.lines.map((line, index) => {
    const service = bookableById.get(line.productId)
    if (!service) {
      throw new CrudHttpError(400, {
        error: 'One or more services are not bookable for this organization.',
        code: 'SERVICE_NOT_BOOKABLE',
      })
    }
    return { service, sortOrder: index }
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

  const appointment = em.create(Appointment, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    customerEntityId: person.entityId,
    customerName,
    customerSalutation: input.customer.salutation ?? null,
    customerEmail: input.customer.email ?? null,
    customerPhone: input.customer.phone,
    customerPhoneCountryCode: input.customer.phoneCountryCode ?? null,
    customerPhoneCountry: input.customer.phoneCountry ?? null,
    status,
    statusCode: status.code,
    requestedStartAt,
    requestedEndAt,
    notes: input.notes ?? null,
  })
  em.persist(appointment)

  for (const line of resolvedLines) {
    em.persist(
      em.create(AppointmentLine, {
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
        sortOrder: line.sortOrder,
      }),
    )
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
