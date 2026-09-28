import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import { PlannerOrganizationAvailabilitySettings } from '../data/entities'
import { plannerOrganizationAvailabilitySettingsSchema } from '../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['planner.view'] },
  PUT: { requireAuth: true, requireFeatures: ['planner.manage_availability'] },
}

async function resolveContext(req: Request): Promise<CommandRuntimeContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
  return {
    container,
    auth,
    organizationScope,
    selectedOrganizationId: organizationId,
    organizationIds: organizationScope?.filterIds ?? [organizationId],
    request: req,
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveContext(req)
    const em = ctx.container.resolve('em') as EntityManager
    const settings = await em.findOne(PlannerOrganizationAvailabilitySettings, {
      tenantId: ctx.auth?.tenantId,
      organizationId: ctx.selectedOrganizationId,
      deletedAt: null,
    })
    return NextResponse.json(settings ? {
      configured: true,
      operatingHoursRuleSetId: settings.operatingHoursRuleSetId,
      lastCustomerBeforeCloseMinutes: settings.lastCustomerBeforeCloseMinutes,
      timeOverflowMinutes: settings.timeOverflowMinutes,
      updatedAt: settings.updatedAt.toISOString(),
    } : {
      configured: false,
      operatingHoursRuleSetId: null,
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
      updatedAt: null,
    })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveContext(req)
    const payload = await readJsonSafe(req, {})
    const parsed = parseScopedCommandInput(
      plannerOrganizationAvailabilitySettingsSchema,
      payload,
      ctx,
      (key, fallback) => fallback ?? key,
    )
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('planner.organization-availability-settings.save', { input: parsed, ctx })
    return GET(req)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid organization availability settings', details: error.issues }, { status: 400 })
    }
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi = {
  tag: 'Planner',
  summary: 'Organization operating hours policy',
  methods: {
    GET: { summary: 'Read organization operating hours policy' },
    PUT: {
      summary: 'Save organization operating hours policy',
      requestBody: { contentType: 'application/json', schema: plannerOrganizationAvailabilitySettingsSchema },
    },
  },
}
