import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createSyncScheduleSchema, listSyncSchedulesQuerySchema } from '../../data/validators'
import type { SyncScheduleService } from '../../lib/sync-schedule-service'
import { serializeSchedule } from './serialize'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
  POST: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'List or create sync schedules',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) {
    return organizationScopeRequiredResponse()
  }

  const url = new URL(req.url)
  const parsed = listSyncSchedulesQuerySchema.safeParse({
    integrationId: url.searchParams.get('integrationId') ?? undefined,
    entityType: url.searchParams.get('entityType') ?? undefined,
    direction: url.searchParams.get('direction') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scheduleService = container.resolve('dataSyncScheduleService') as SyncScheduleService
  const scope = { organizationId, tenantId: auth.tenantId }
  const { items, total } = await scheduleService.listSchedules(parsed.data, scope)

  return NextResponse.json({
    items: items.map(serializeSchedule),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) {
    return organizationScopeRequiredResponse()
  }

  const payload = await readJsonSafe(req)
  const parsed = createSyncScheduleSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const scheduleService = container.resolve('dataSyncScheduleService') as SyncScheduleService
  const scope = { organizationId, tenantId: auth.tenantId }

  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub, tenantId: auth.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: 'data_sync.schedule',
      resourceId: scope.organizationId,
      operation: 'create',
      mutationPayload: parsed.data,
    },
  })
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
  }

  try {
    const schedule = await scheduleService.saveSchedule({
      ...parsed.data,
      expectedUpdatedAt: readOptimisticLockExpected(req),
    }, scope, container)

    await guardResult.runAfterSuccess({ resourceId: schedule.id })

    return NextResponse.json(serializeSchedule(schedule), { status: 201 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to save sync schedule'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
