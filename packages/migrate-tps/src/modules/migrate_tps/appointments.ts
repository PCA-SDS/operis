import type { EntityManager } from '@mikro-orm/postgresql'
import * as pg from 'pg'
import { randomUUID } from 'node:crypto'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Appointment, AppointmentLine, AppointmentStatus, AppointmentLineOption, AppointmentLineOptionGroup } from '@open-mercato/core/modules/appointments/data/entities'
import { ensureSystemAppointmentStatuses } from '@open-mercato/core/modules/appointments/setup'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CatalogProduct, CatalogProductOption, CatalogProductOptionGroup, CatalogProductPrice, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { ResourcesAssignment, ResourcesResource } from '@open-mercato/core/modules/resources/data/entities'
import { StaffTeamMember } from '@open-mercato/core/modules/staff/data/entities'
import { TPS_LOCATION_MAPPING } from './lib'

type Client = InstanceType<typeof pg.Client>

type TpsBooking = {
  id: string
  customer_id: string
  location: string
  type_of_booking: string | null
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  phone_country_code: string | null
  phone_country: string | null
  salutation: string | null
  origin: string | null
  internal_notes: string | null
  external_notes: string | null
  service_selections: unknown
  created_at: Date
  updated_at: Date
  requested_start_at: Date
  status_id: string
  deleted_at: Date | null
}

type TpsStatus = { id: string; value: string }
type TpsAllocation = {
  id: string
  booking_id: string
  seat_id: string
  start_at: Date
  end_at: Date
  service_item_id: string | null
  service_name: string | null
  duration_minutes: number | null
  state: string
}
type TpsEmployee = { booking_allocation_id: string; employee_id: string }
type TpsSeat = { id: string; location: string; code: string; name: string | null }
type TpsSelection = {
  itemId?: string
  itemName?: string
  duration?: string
  selectedOptionsDetails?: Array<{ optionId?: string }>
}

const logger = createLogger('migrate_tps')
const APPOINTMENT_MARKER = 'tps-booking-id:'
const CUSTOMER_MARKER = 'tps-customer-id:'
const STAFF_MARKER = 'tps-account-id:'

function marker(prefix: string, id: string): string {
  return `[${prefix}${id}]`
}

function parseSelections(value: unknown): TpsSelection[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is TpsSelection => Boolean(entry && typeof entry === 'object'))
}

function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null
  const match = value.match(/(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs|minute|minutes|min|mins)/i)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  return /hour|hr/i.test(match[2] ?? '') ? Math.round(amount * 60) : Math.round(amount)
}

function normalizeStatusCode(value: string): string {
  const code = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return code.slice(0, 64) || 'tps_status'
}

function mapStatus(value: string | null | undefined): { code: string; label: string } {
  const source = value?.trim().toLowerCase() || 'new_request'
  if (source === 'cancelled') return { code: 'cancelled', label: 'Cancelled' }
  if (source === 'in_progress') return { code: 'in_progress', label: 'In progress' }
  if (source === 'new_request') return { code: 'new_request', label: 'New request' }
  if (source === 'completed') return { code: 'completed', label: 'Completed' }
  if (source === 'booked' || source.endsWith('_booked')) return { code: 'booked', label: 'Booked' }
  return { code: normalizeStatusCode(source), label: source.replaceAll('_', ' ') }
}

async function connectTps(url: string): Promise<Client> {
  const connectionUrl = new URL(url)
  connectionUrl.searchParams.delete('sslmode')
  const client = new pg.Client({
    connectionString: connectionUrl.toString(),
    ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

async function ensureStatus(em: EntityManager, tenantId: string, input: { code: string; label: string }): Promise<AppointmentStatus> {
  let status = await em.findOne(AppointmentStatus, { tenantId, code: input.code, deletedAt: null })
  if (!status) {
    status = em.create(AppointmentStatus, {
      id: randomUUID(),
      tenantId,
      code: input.code,
      label: input.label,
      description: `Imported from TPS status ${input.code}.`,
      isSystem: false,
      sortOrder: 100,
    })
    em.persist(status)
  }
  return status
}

function durationInMinutes(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (!value || value <= 0) return null
  return unit && /hour|hr/i.test(unit) ? value * 60 : value
}

function createOptionSnapshots(
  em: EntityManager,
  line: AppointmentLine,
  selectedOptions: Record<string, string>,
  groupsById: Map<string, CatalogProductOptionGroup>,
  optionsById: Map<string, CatalogProductOption>,
): void {
  let sortOrder = 0
  for (const [groupId, optionId] of Object.entries(selectedOptions)) {
    const group = groupsById.get(groupId)
    const option = optionsById.get(optionId)
    if (!group || !option) continue
    const groupSnapshot = em.create(AppointmentLineOptionGroup, {
      id: randomUUID(), line, catalogGroupId: group.id, parentOptionId: group.parentOption?.id ?? null,
      groupName: group.name, requirement: group.requirement, selectMode: group.selectMode,
      sortOrder: sortOrder++, isRootGroup: !group.parentOption, breadcrumbPath: null,
    })
    em.persist(groupSnapshot)
    em.persist(em.create(AppointmentLineOption, {
      id: randomUUID(), group: groupSnapshot, catalogOptionId: option.id, optionName: option.name,
      code: option.code ?? null, note: option.note ?? null, priceFlat: option.priceFlat ?? null,
      priceMin: option.priceMin ?? null, priceMax: option.priceMax ?? null,
      durationValue: option.durationValue ?? null, durationUnit: option.durationUnit ?? null,
      isAddon: option.isAddon, sortOrder: 0,
    }))
  }
}

async function migrateAppointments(
  em: EntityManager,
  bookings: TpsBooking[],
  statuses: Map<string, TpsStatus>,
  allocations: TpsAllocation[],
  employees: TpsEmployee[],
  seats: TpsSeat[],
  tenantId: string,
  rootOrgId: string,
  replace: boolean,
): Promise<{ created: number; updated: number; skipped: number; lines: number; assignments: number; unresolvedCustomers: number; unresolvedServices: number }> {
  await ensureSystemAppointmentStatuses(em, tenantId)
  const organizations = await em.find(Organization, { tenant: tenantId as unknown as any, deletedAt: null })
  const organizationByLocation = new Map<string, string>()
  for (const location of TPS_LOCATION_MAPPING) {
    const organization = organizations.find((entry) => entry.slug === location.slug)
    if (organization) organizationByLocation.set(location.tpsKey, organization.id)
  }

  const customers = await em.find(CustomerEntity, { tenantId, kind: 'person', deletedAt: null })
  const customerByMarker = new Map(customers.filter((entry) => entry.description).map((entry) => [entry.description!, entry]))
  const products = await em.find(CatalogProduct, { tenantId, deletedAt: null })
  const productBySourceId = new Map<string, CatalogProduct>()
  for (const product of products) {
    const sourceId = typeof product.metadata?.tps_id === 'string' ? product.metadata.tps_id : null
    if (sourceId) productBySourceId.set(sourceId, product)
  }
  const productIds = products.map((product) => product.id)
  const [variants, prices, groups, options] = await Promise.all([
    em.find(CatalogProductVariant, { tenantId, product: { $in: productIds }, deletedAt: null }),
    em.find(CatalogProductPrice, { tenantId, product: { $in: productIds } }),
    em.find(CatalogProductOptionGroup, { tenantId, product: { $in: productIds }, deletedAt: null }),
    em.find(CatalogProductOption, { tenantId, deletedAt: null }),
  ])
  const variantByProduct = new Map<string, CatalogProductVariant>()
  for (const variant of variants) if (!variantByProduct.has(variant.product.id)) variantByProduct.set(variant.product.id, variant)
  const priceByProduct = new Map<string, CatalogProductPrice>()
  for (const price of prices) {
    if (price.product && !priceByProduct.has(price.product.id)) priceByProduct.set(price.product.id, price)
  }
  const optionByProductAndSource = new Map<string, CatalogProductOption>()
  const groupsByProduct = new Map<string, Map<string, CatalogProductOptionGroup>>()
  const groupsById = new Map<string, CatalogProductOptionGroup>()
  const optionsById = new Map<string, CatalogProductOption>()
  for (const group of groups) {
    groupsById.set(group.id, group)
    const productGroups = groupsByProduct.get(group.product.id) ?? new Map<string, CatalogProductOptionGroup>()
    productGroups.set(group.id, group)
    groupsByProduct.set(group.product.id, productGroups)
  }
  for (const option of options) {
    optionsById.set(option.id, option)
    const sourceId = typeof option.metadata?.tps_id === 'string' ? option.metadata.tps_id : null
    const product = option.group.product
    if (sourceId && product) optionByProductAndSource.set(`${product.id}:${sourceId}`, option)
  }

  const resources = await em.find(ResourcesResource, { tenantId, deletedAt: null })
  const resourceByOrganizationAndName = new Map(resources.map((resource) => [`${resource.organizationId}:${resource.name.trim().toLowerCase()}`, resource]))
  const staff = await em.find(StaffTeamMember, { tenantId, deletedAt: null })
  const staffByOrganizationAndMarker = new Map(staff.filter((entry) => entry.description).map((entry) => [`${entry.organizationId}:${entry.description}`, entry]))
  const seatById = new Map(seats.map((seat) => [seat.id, seat]))
  const allocationsByBooking = new Map<string, TpsAllocation[]>()
  for (const allocation of allocations) allocationsByBooking.set(allocation.booking_id, [...(allocationsByBooking.get(allocation.booking_id) ?? []), allocation])
  const employeesByAllocation = new Map<string, string[]>()
  for (const employee of employees) employeesByAllocation.set(employee.booking_allocation_id, [...(employeesByAllocation.get(employee.booking_allocation_id) ?? []), employee.employee_id])
  const existingAppointments = await em.find(Appointment, { tenantId, deletedAt: null })
  const migratedAppointments = existingAppointments.filter((entry) => entry.externalNotes?.startsWith(`[${APPOINTMENT_MARKER}`))
  if (replace && migratedAppointments.length > 0) {
    const migratedAppointmentIds = migratedAppointments.map((entry) => entry.id)
    const oldLines = await em.find(AppointmentLine, { appointment: { $in: migratedAppointmentIds } })
    const oldLineIds = oldLines.map((line) => line.id)
    if (oldLineIds.length > 0) {
      const oldGroups = await em.find(AppointmentLineOptionGroup, { line: { $in: oldLineIds } })
      const oldGroupIds = oldGroups.map((group) => group.id)
      await em.nativeDelete(ResourcesAssignment, { sourceEntityId: { $in: oldLineIds } })
      if (oldGroupIds.length > 0) await em.nativeDelete(AppointmentLineOption, { group: { $in: oldGroupIds } })
      await em.nativeDelete(AppointmentLineOptionGroup, { line: { $in: oldLineIds } })
      await em.nativeDelete(AppointmentLine, { id: { $in: oldLineIds } })
    }
    await em.nativeDelete(Appointment, { id: { $in: migratedAppointmentIds } })
  }
  const appointmentByMarker = new Map((replace ? [] : existingAppointments).filter((entry) => entry.externalNotes?.startsWith(`[${APPOINTMENT_MARKER}`)).map((entry) => [entry.externalNotes!.split('\n')[0]!, entry]))

  let created = 0
  let updated = 0
  let skipped = 0
  let lines = 0
  let assignments = 0
  let unresolvedCustomers = 0
  let unresolvedServices = 0

  for (const booking of bookings) {
    const appointmentMarker = marker(APPOINTMENT_MARKER, booking.id)
    let appointment = appointmentByMarker.get(appointmentMarker)
    if (appointment && !replace) {
      skipped++
      continue
    }
    const organizationId = organizationByLocation.get(booking.location) ?? rootOrgId
    const customer = customerByMarker.get(marker(CUSTOMER_MARKER, booking.customer_id))
    if (!customer) {
      unresolvedCustomers++
      logger.warn(`Skipping TPS booking ${booking.id}: customer ${booking.customer_id} was not migrated`)
      continue
    }
    const status = await ensureStatus(em, tenantId, mapStatus(statuses.get(booking.status_id)?.value))
    const selections = parseSelections(booking.service_selections)
    const bookingAllocations = allocationsByBooking.get(booking.id) ?? []
    const allocationEnd = bookingAllocations.reduce<Date | null>((latest, entry) => !latest || entry.end_at > latest ? entry.end_at : latest, null)
    const selectionDuration = selections.reduce((total, entry) => total + (parseDuration(entry.duration) ?? 0), 0)
    const requestedEndAt = allocationEnd ?? new Date(booking.requested_start_at.getTime() + selectionDuration * 60_000)

    if (!appointment) {
      appointment = em.create(Appointment, {
        id: randomUUID(), tenantId, organizationId, customerEntityId: customer.id,
        customerName: booking.customer_name, customerSalutation: booking.salutation,
        customerEmail: booking.customer_email, customerPhone: booking.customer_phone,
        customerPhoneCountryCode: booking.phone_country_code, customerPhoneCountry: booking.phone_country,
        customerOrigin: booking.origin, bookingType: booking.type_of_booking, status, statusCode: status.code,
        requestedStartAt: booking.requested_start_at, requestedEndAt, notes: booking.internal_notes,
        externalNotes: `${appointmentMarker}${booking.external_notes ? `\n${booking.external_notes}` : ''}`,
        createdAt: booking.created_at, updatedAt: booking.updated_at,
      })
      em.persist(appointment)
      appointmentByMarker.set(appointmentMarker, appointment)
      created++
    } else {
      appointment.organizationId = organizationId
      appointment.customerEntityId = customer.id
      appointment.customerName = booking.customer_name
      appointment.customerSalutation = booking.salutation
      appointment.customerEmail = booking.customer_email
      appointment.customerPhone = booking.customer_phone
      appointment.customerPhoneCountryCode = booking.phone_country_code
      appointment.customerPhoneCountry = booking.phone_country
      appointment.customerOrigin = booking.origin
      appointment.bookingType = booking.type_of_booking
      appointment.status = status
      appointment.statusCode = status.code
      appointment.requestedStartAt = booking.requested_start_at
      appointment.requestedEndAt = requestedEndAt
      appointment.notes = booking.internal_notes
      appointment.externalNotes = `${appointmentMarker}${booking.external_notes ? `\n${booking.external_notes}` : ''}`
      updated++
    }

    const allocationsByService = new Map<string, TpsAllocation[]>()
    for (const allocation of bookingAllocations) allocationsByService.set(allocation.service_item_id ?? '', [...(allocationsByService.get(allocation.service_item_id ?? '') ?? []), allocation])
    for (const [sortOrder, selection] of selections.entries()) {
      const product = selection.itemId ? productBySourceId.get(selection.itemId) : undefined
      if (!product) {
        unresolvedServices++
        logger.warn(`Booking ${booking.id}: service ${selection.itemId ?? '(missing)'} was not migrated`)
        continue
      }
      const matchingAllocations = allocationsByService.get(selection.itemId ?? '') ?? []
      const lineAllocations = matchingAllocations.length > 0 ? matchingAllocations : [undefined]
      const allocation = lineAllocations[0]
      const selectedOptions: Record<string, string> = {}
      for (const selected of selection.selectedOptionsDetails ?? []) {
        if (!selected.optionId) continue
        const option = optionByProductAndSource.get(`${product.id}:${selected.optionId}`)
        if (!option) continue
        const groupId = typeof option.group === 'string' ? option.group : option.group.id
        selectedOptions[groupId] = option.id
      }
      const variant = variantByProduct.get(product.id)
      const duration = allocation?.duration_minutes ?? parseDuration(selection.duration) ?? durationInMinutes(variant?.durationValue, variant?.durationUnit) ?? 60
      const price = priceByProduct.get(product.id)
      const line = em.create(AppointmentLine, {
        id: randomUUID(), appointment, tenantId, organizationId, productId: product.id, productTitle: product.title,
        productHandle: product.handle, currencyCode: price?.currencyCode ?? 'VND',
        unitPriceNet: price?.unitPriceNet ?? null, unitPriceGross: price?.unitPriceGross ?? null,
        durationMinutes: duration, selectedOptions, sortOrder,
      })
      em.persist(line)
      createOptionSnapshots(em, line, selectedOptions, groupsByProduct.get(product.id) ?? groupsById, optionsById)
      lines++
      for (const lineAllocation of lineAllocations) {
        if (!lineAllocation) continue
        const seat = seatById.get(lineAllocation.seat_id)
        const resourceName = seat?.name?.trim() || seat?.code
        const resource = resourceName ? resourceByOrganizationAndName.get(`${organizationId}:${resourceName.toLowerCase()}`) : undefined
        if (!resource) {
          logger.warn(`Booking ${booking.id}: resource ${lineAllocation.seat_id} was not found in organization ${organizationId}`)
          continue
        }
        const assignedMemberIds = (employeesByAllocation.get(lineAllocation.id) ?? [])
          .map((sourceId) => staffByOrganizationAndMarker.get(`${organizationId}:${marker(STAFF_MARKER, sourceId)}`)?.id)
          .filter((id): id is string => Boolean(id))
        em.persist(em.create(ResourcesAssignment, {
          tenantId, organizationId, sourceModule: 'appointment', sourceEntityType: 'appointment_line', sourceEntityId: line.id,
          resource, state: lineAllocation.state === 'confirmed' ? 'confirmed' : 'draft', startsAt: lineAllocation.start_at, endsAt: lineAllocation.end_at,
          assignedMemberId: assignedMemberIds[0] ?? null, assignedMemberIds, title: product.title,
          createdAt: booking.created_at, updatedAt: booking.updated_at,
        }))
        assignments++
      }
    }
  }
  return { created, updated, skipped, lines, assignments, unresolvedCustomers, unresolvedServices }
}

export const migrateTpsAppointmentsCommand: ModuleCli = {
  command: 'appointments',
  async run(rest) {
    const positional = rest.filter((argument) => !argument.startsWith('--'))
    const tenantId = positional[0]
    const rootOrgId = positional[1]
    if (!tenantId || !rootOrgId) throw new Error('Usage: yarn mercato migrate_tps appointments <tenantId> <rootOrgId> [--replace]')
    const tpsUrl = process.env.TPS_DATABASE_URL
    if (!tpsUrl) throw new Error('TPS_DATABASE_URL is required for appointment migration')
    const replace = rest.includes('--replace')
    const container = await createRequestContainer()
    let client: Client | null = null
    try {
      client = await connectTps(tpsUrl)
      const [bookingResult, statusResult, allocationResult, employeeResult, seatResult] = await Promise.all([
        client.query<TpsBooking>('SELECT id, customer_id, location::text, type_of_booking::text, customer_name, customer_email, customer_phone, phone_country_code, phone_country, salutation::text, origin, internal_notes, external_notes, service_selections, created_at, updated_at, requested_start_at, status_id, deleted_at FROM bookings ORDER BY id'),
        client.query<TpsStatus>('SELECT id, value FROM statuses'),
        client.query<TpsAllocation>('SELECT id, booking_id, seat_id, start_at, end_at, service_item_id, service_name, duration_minutes, state::text FROM booking_allocations'),
        client.query<TpsEmployee>('SELECT booking_allocation_id, employee_id FROM booking_allocation_employees'),
        client.query<TpsSeat>('SELECT s.id, f.location::text, s.code, s.name FROM seats s JOIN floors f ON f.id = s.floor_id'),
      ])
      const containerEm = container.resolve<EntityManager>('em').fork()
      await containerEm.transactional(async (em) => {
        const stats = await migrateAppointments(em, bookingResult.rows.filter((booking) => !booking.deleted_at), new Map(statusResult.rows.map((status) => [status.id, status])), allocationResult.rows, employeeResult.rows, seatResult.rows, tenantId, rootOrgId, replace)
        await em.flush()
        logger.info(`Appointments: created=${stats.created}, updated=${stats.updated}, skipped=${stats.skipped}, lines=${stats.lines}, assignments=${stats.assignments}`)
        if (stats.unresolvedCustomers > 0) logger.warn(`Missing customers: ${stats.unresolvedCustomers}`)
        if (stats.unresolvedServices > 0) logger.warn(`Missing services: ${stats.unresolvedServices}`)
      })
    } finally {
      if (client) await client.end()
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
    }
  },
}
