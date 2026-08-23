import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceTenantSelection } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { UserModuleService } from '@open-mercato/core/modules/auth/lib/userModules'
import type { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'

const logger = createLogger('auth').child({ component: 'user-modules-api' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.users.modules.view'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.users.modules.manage'] },
} as const

const listQuerySchema = z.object({ userId: z.string().uuid() })

const updateBodySchema = z.object({
  userId: z.string().uuid(),
  moduleId: z.string().min(1),
  isEnabled: z.boolean(),
})

const userModuleSchema = z.object({
  moduleId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  isEnabled: z.boolean(),
})

const listResponseSchema = z.object({
  items: z.array(userModuleSchema),
})

const errorSchema = z.object({ error: z.string() })
const okSchema = z.object({ ok: z.boolean() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { translate } = await resolveTranslations()

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({ userId: url.searchParams.get('userId') ?? undefined })
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('auth.userModules.errors.userIdRequired', 'A userId is required') },
      { status: 400 },
    )
  }

  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const user = await em.fork().findOne(User, { id: parsed.data.userId, deletedAt: null })
    if (!user) {
      return NextResponse.json(
        { error: translate('auth.userModules.errors.userNotFound', 'User not found') },
        { status: 404 },
      )
    }
    await enforceTenantSelection({ auth, container }, user.tenantId ?? null)

    const tenantModules = container.resolve('tenantModuleService') as TenantModuleService
    const userModules = container.resolve('userModuleService') as UserModuleService
    // Only modules the tenant actually holds are listed, so a module the Super
    // Admin withheld never appears as an assignable option (hierarchy Rule 2).
    const tenantEnabled = await tenantModules.getEnabledModuleIds(user.tenantId ?? null)
    const items = await userModules.listUserModules(user.id, user.tenantId ?? null, tenantEnabled)
    return NextResponse.json({ items })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('Failed to list user modules', { err })
    return NextResponse.json(
      { error: translate('auth.userModules.errors.loadFailed', 'Failed to load user modules') },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { translate } = await resolveTranslations()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: translate('auth.userModules.errors.invalidBody', 'Invalid request body') },
      { status: 400 },
    )
  }

  const parsed = updateBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('auth.userModules.errors.invalidBody', 'Invalid request body') },
      { status: 400 },
    )
  }

  try {
    const container = await createRequestContainer()
    const commandBus = container.resolve('commandBus') as CommandBus
    // The command re-resolves the target user and re-runs the tenant guard, so
    // the write stays authorized when it is invoked from the CLI or an AI tool
    // rather than through this route.
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: null,
      request: req,
    }
    await commandBus.execute('auth.user_modules.set', { input: parsed.data, ctx })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('Failed to update user module restriction', { err })
    return NextResponse.json(
      { error: translate('auth.userModules.errors.saveFailed', 'Failed to update module availability') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Auth',
  summary: 'Per-user module availability',
  methods: {
    GET: {
      summary: 'List module availability for a user',
      description: 'Returns every module the user\'s tenant is entitled to, with whether this user may currently reach it. Modules the tenant does not hold are omitted.',
      responses: [
        { status: 200, description: 'User module availability', schema: listResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing or invalid userId', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Target user belongs to another tenant', schema: errorSchema },
        { status: 404, description: 'User not found', schema: errorSchema },
        { status: 500, description: 'Failed to load user modules', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Grant or withhold a module for one user',
      description: 'Withholds a module from a single user, or clears an existing restriction. Never grants beyond the tenant entitlement: a module the tenant does not hold is rejected with FEATURE_NOT_AVAILABLE.',
      responses: [
        { status: 200, description: 'Availability updated', schema: okSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body or platform module', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Another tenant, or a module the tenant is not entitled to', schema: errorSchema },
        { status: 404, description: 'User not found', schema: errorSchema },
      ],
    },
  },
}
