import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CatalogProductOption } from '@open-mercato/core/modules/catalog/data/entities'
import { ResourcesAssignment } from '@open-mercato/core/modules/resources/data/entities'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import {
  Appointment,
  AppointmentLine,
  AppointmentLineOption,
  AppointmentLineOptionGroup,
} from '../data/entities'
import { appointmentStaffCreateSchema } from '../data/validators'
import { createAppointmentFromPublicIntake } from '../lib/intake'
import { emitAppointmentEvent } from '../events'
import { deriveScheduleConfirmationStatus } from '../lib/scheduleTracking'
import { compareAppointmentListRows } from '../lib/appointmentListSorting'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
  POST: { requireAuth: true, requireFeatures: ['appointments.create'] },
}

const appointmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().optional(),
  statusCode: z.string().trim().optional(),
  organizationId: z.string().uuid().optional(),
})

function mapAppointment(row: Appointment, organizationName: string | null = null) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    organizationName,
    customerEntityId: row.customerEntityId,
    customerName: row.customerName,
    customerSalutation: row.customerSalutation ?? null,
    customerPhone: row.customerPhone ?? null,
    customerEmail: row.customerEmail ?? null,
    customerPhoneCountryCode: row.customerPhoneCountryCode ?? null,
    customerOrigin: row.customerOrigin ?? null,
    bookingType: row.bookingType ?? null,
    statusCode: row.statusCode,
    requestedStartAt: row.requestedStartAt.toISOString(),
    requestedEndAt: row.requestedEndAt?.toISOString() ?? null,
    notes: row.notes ?? null,
    externalNotes: row.externalNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function collectSelectedOptionIds(value: unknown): string[] {
  const optionIds = new Set<string>()
  const addOptionId = (candidate: unknown) => {
    if (typeof candidate === 'string' && z.string().uuid().safeParse(candidate).success) {
      optionIds.add(candidate)
    }
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        addOptionId((entry as Record<string, unknown>).optionId)
      } else {
        addOptionId(entry)
      }
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const selected of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(selected)) selected.forEach(addOptionId)
      else addOptionId(selected)
    }
  }

  return Array.from(optionIds)
}

function mapAppointmentTotals(
  lines: AppointmentLine[],
  optionGroups: AppointmentLineOptionGroup[],
  options: AppointmentLineOption[],
  legacyOptionPricesById: Map<string, number>,
) {
  const optionsByGroupId = new Map<string, AppointmentLineOption[]>()
  for (const option of options) {
    const groupId = String(option.group.id)
    const groupOptions = optionsByGroupId.get(groupId) ?? []
    groupOptions.push(option)
    optionsByGroupId.set(groupId, groupOptions)
  }
  const optionTotalsByLineId = new Map<string, number>()
  for (const group of optionGroups) {
    const lineId = String(group.line.id)
    for (const option of optionsByGroupId.get(group.id) ?? []) {
      if (option.priceFlat == null || option.priceFlat.trim() === '') continue
      const amount = Number(option.priceFlat)
      if (!Number.isFinite(amount)) continue
      optionTotalsByLineId.set(lineId, (optionTotalsByLineId.get(lineId) ?? 0) + amount)
    }
  }

  const totals = new Map<string, { amount: number; currencyCode: string | null }>()
  const linesWithOptionSnapshots = new Set(optionGroups.map((group) => String(group.line.id)))
  for (const line of lines) {
    const appointmentId = String(line.appointment.id)
    const rawAmount = line.unitPriceGross ?? line.unitPriceNet
    const baseAmount = rawAmount == null || rawAmount.trim() === '' ? null : Number(rawAmount)
    let optionAmount = optionTotalsByLineId.get(line.id) ?? 0
    let hasOptionPrice = optionTotalsByLineId.has(line.id)
    if (!linesWithOptionSnapshots.has(line.id)) {
      for (const optionId of collectSelectedOptionIds(line.selectedOptions)) {
        const legacyOptionPrice = legacyOptionPricesById.get(optionId)
        if (legacyOptionPrice === undefined) continue
        optionAmount += legacyOptionPrice
        hasOptionPrice = true
      }
    }
    const hasValidBaseAmount = baseAmount != null && Number.isFinite(baseAmount)
    if (!hasValidBaseAmount && !hasOptionPrice) continue
    const amount = (hasValidBaseAmount ? baseAmount : 0) + optionAmount
    if (!Number.isFinite(amount)) continue
    const current = totals.get(appointmentId)
    totals.set(appointmentId, {
      amount: (current?.amount ?? 0) + amount,
      currencyCode: current?.currencyCode ?? line.currencyCode ?? null,
    })
  }
  return totals
}

async function resolveOrganizationNames(
  em: EntityManager,
  organizationIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(organizationIds.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map()
  const organizations = await em.find(Organization, {
    id: { $in: uniqueIds },
    deletedAt: null,
  })
  return new Map(
    organizations.map((org) => {
      const id = String(org.id)
      const name = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : id
      return [id, name]
    }),
  )
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(req.url)
    const queryResult = appointmentListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!queryResult.success) {
      return NextResponse.json(
        { error: translate('appointments.list.invalidQuery', 'Invalid input'), code: 'INVALID_INPUT' },
        { status: 400 },
      )
    }
    const query = queryResult.data
    const statusCodes = (query.statusCode ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    // `?organizationId=` is caller input, so it goes through the allow-list
    // rather than into the query. `resolveOrganizationScopeForRequest` honors a
    // selection only when the principal may act on it and otherwise falls back
    // to their own accessible scope, so a restricted caller asking for another
    // branch reads their own rows instead of that branch's.
    const scope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: req,
      selectedId: query.organizationId,
    })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null

    const where: Record<string, unknown> = {
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    if (organizationId) where.organizationId = organizationId
    if (statusCodes.length === 1) where.statusCode = statusCodes[0]
    if (statusCodes.length > 1) where.statusCode = { $in: statusCodes }

    if (query.search) {
      const searchPattern = buildIlikeTerm(query.search)
      const matchingOrganizations = await em.find(Organization, {
        tenant: auth.tenantId,
        deletedAt: null,
        name: { $ilike: searchPattern },
      }, { fields: ['id'] })
      const searchFilters: Record<string, unknown>[] = [
        { customerName: { $ilike: searchPattern } },
        { customerSalutation: { $ilike: searchPattern } },
        { customerEmail: { $ilike: searchPattern } },
        { customerPhone: { $ilike: searchPattern } },
        { customerPhoneCountryCode: { $ilike: searchPattern } },
        { bookingType: { $ilike: searchPattern } },
        { statusCode: { $ilike: searchPattern } },
        { notes: { $ilike: searchPattern } },
        { externalNotes: { $ilike: searchPattern } },
      ]
      const matchingAppointmentId = z.string().uuid().safeParse(query.search)
      if (matchingAppointmentId.success) {
        searchFilters.push({ id: matchingAppointmentId.data })
      }
      if (matchingOrganizations.length > 0) {
        searchFilters.push({ organizationId: { $in: matchingOrganizations.map((organization) => organization.id) } })
      }
      where.$or = searchFilters
    }

    const [rows, total] = await em.findAndCount(Appointment, where, {
      orderBy: { createdAt: 'desc', requestedStartAt: 'desc' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })
    const lines = rows.length > 0
      ? await em.find(AppointmentLine, {
        appointment: { $in: rows.map((row) => row.id) },
        tenantId: auth.tenantId,
        deletedAt: null,
      })
      : []
    const lineIds = lines.map((line) => line.id)
    const assignments = lineIds.length > 0
      ? await em.find(ResourcesAssignment, {
        tenantId: auth.tenantId,
        sourceModule: 'appointment',
        sourceEntityType: 'appointment_line',
        sourceEntityId: { $in: lineIds },
        state: 'confirmed',
        cancelledAt: null,
      })
      : []
    const confirmedAllocationCountByAppointment = new Map<string, number>()
    const lineAppointmentById = new Map(lines.map((line) => [line.id, String(line.appointment.id)]))
    for (const assignment of assignments) {
      const appointmentId = lineAppointmentById.get(assignment.sourceEntityId)
      if (!appointmentId) continue
      confirmedAllocationCountByAppointment.set(
        appointmentId,
        (confirmedAllocationCountByAppointment.get(appointmentId) ?? 0) + 1,
      )
    }
    const optionGroups = lineIds.length > 0
      ? await em.find(AppointmentLineOptionGroup, { line: { $in: lineIds } })
      : []
    const optionGroupIds = optionGroups.map((group) => group.id)
    const options = optionGroupIds.length > 0
      ? await em.find(AppointmentLineOption, { group: { $in: optionGroupIds } })
      : []
    const linesWithOptionSnapshots = new Set(optionGroups.map((group) => String(group.line.id)))
    const legacyOptionLines = lines.filter((line) => !linesWithOptionSnapshots.has(line.id))
    const legacyOptionIds = Array.from(new Set(legacyOptionLines.flatMap((line) =>
      collectSelectedOptionIds(line.selectedOptions),
    )))
    const legacyOrganizationIds = Array.from(new Set(legacyOptionLines.map((line) => line.organizationId)))
    const organizations = legacyOrganizationIds.length > 0
      ? await em.find(Organization, { id: { $in: legacyOrganizationIds }, deletedAt: null })
      : []
    const catalogOrganizationIds = Array.from(new Set([
      ...legacyOrganizationIds,
      ...organizations.flatMap((organization) => organization.ancestorIds ?? []),
    ]))
    const legacyOptions = legacyOptionIds.length > 0 && catalogOrganizationIds.length > 0
      ? await em.find(CatalogProductOption, {
        id: { $in: legacyOptionIds },
        tenantId: auth.tenantId,
        organizationId: { $in: catalogOrganizationIds },
        deletedAt: null,
      })
      : []
    const legacyOptionPricesById = new Map<string, number>()
    for (const option of legacyOptions) {
      if (option.priceFlat == null || option.priceFlat.trim() === '') continue
      const amount = Number(option.priceFlat)
      if (Number.isFinite(amount)) legacyOptionPricesById.set(option.id, amount)
    }
    const totals = mapAppointmentTotals(lines, optionGroups, options, legacyOptionPricesById)
    const orgNames = await resolveOrganizationNames(
      em,
      rows.map((row) => row.organizationId),
    )
    const items = rows.map((row) => {
        const confirmedAllocationCount = confirmedAllocationCountByAppointment.get(row.id) ?? 0
        const scheduleConfirmationStatus = deriveScheduleConfirmationStatus({
          createdAt: row.createdAt,
          confirmedAllocationCount,
          statusCode: row.statusCode,
        })
        const total = totals.get(row.id)
        return {
          ...mapAppointment(row, orgNames.get(row.organizationId) ?? null),
          totalAmount: total?.amount ?? null,
          currencyCode: total?.currencyCode ?? null,
          scheduleConfirmationStatus,
        }
      })
    items.sort(compareAppointmentListRows)
    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    })
  } catch {
    return NextResponse.json(
      {
        error: translate('appointments.list.failed', 'Unable to list appointments.'),
        code: 'LIST_FAILED',
      },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = appointmentStaffCreateSchema.parse(await req.json())
    const container = await createRequestContainer()
    // The module's own AGENTS.md: "Staff create uses auth tenant/org — never
    // trust client-supplied scope on POST /api/appointments." A body id is only
    // honored when the principal may act on that organization.
    const createScope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: req,
      selectedId: body.organizationId ?? undefined,
    })
    const organizationId = createScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        {
          error: translate(
            'appointments.create.scopeRequired',
            'Active tenant and organization are required.',
          ),
          code: 'SCOPE_REQUIRED',
        },
        { status: 400 },
      )
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const pricingService = container.resolve<CatalogPricingService>('catalogPricingService')
    const { organizationId: _ignoredOrganizationId, ...intakeBody } = body
    const result = await createAppointmentFromPublicIntake(
      em,
      {
        ...intakeBody,
        tenantId: auth.tenantId,
        organizationId,
      },
      { pricingService },
    )
    try {
      await emitAppointmentEvent('appointments.appointment.created', {
        id: result.id,
        tenantId: auth.tenantId,
        organizationId,
        customerName: [body.customer.firstName, body.customer.lastName].filter(Boolean).join(' '),
      })
    } catch {
      /* best-effort */
    }
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: translate('appointments.create.invalidInput', 'Invalid appointment payload.'),
          code: 'INVALID_INPUT',
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: translate('appointments.create.failed', 'Unable to create appointment.'),
        code: 'CREATE_FAILED',
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Staff appointment list and create',
  methods: {
    GET: {
      summary: 'List appointments for the active tenant/org',
      responses: [{ status: 200, description: 'Appointment list' }],
    },
    POST: {
      summary: 'Create appointment (staff)',
      description:
        'Uses authenticated tenant/org. Find-or-creates customer, validates bookable services, stores snapshots, status new_request.',
      requestBody: { contentType: 'application/json', schema: appointmentStaffCreateSchema },
      responses: [
        { status: 201, description: 'Created' },
        { status: 400, description: 'Invalid input or missing scope' },
      ],
    },
  },
}
