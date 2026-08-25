import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'
import { directoryTag, directoryErrorSchema, directoryOkSchema } from '../openapi'

const logger = createLogger('directory').child({ component: 'tenant-modules-api' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['directory.tenants.view'] },
  PUT: { requireAuth: true, requireFeatures: ['directory.tenants.manage'] },
} as const

const listQuerySchema = z.object({ tenantId: z.string().uuid() })

/**
 * `target` selects which switch the write moves: the module grant itself, or
 * the module's AI assistant sub-toggle. One endpoint rather than two so the
 * screen has a single write path, but two commands behind it so the audit log
 * can tell a withheld module from a withheld assistant.
 */
const updateBodySchema = z.object({
  tenantId: z.string().uuid(),
  moduleId: z.string().min(1),
  isEnabled: z.boolean(),
  target: z.enum(['module', 'aiAssistant']).default('module'),
})

const tenantModuleSchema = z.object({
  moduleId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  isEnabled: z.boolean(),
  category: z.string(),
  sortOrder: z.number(),
  alwaysOn: z.boolean(),
  missingDependencies: z.array(z.string()),
  dependents: z.array(z.string()),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  aiAssistantAvailable: z.boolean(),
  aiAssistantEnabled: z.boolean(),
})

const listResponseSchema = z.object({
  items: z.array(tenantModuleSchema),
})

async function resolveService(): Promise<TenantModuleService> {
  const container = await createRequestContainer()
  return container.resolve('tenantModuleService') as TenantModuleService
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { translate } = await resolveTranslations()

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({ tenantId: url.searchParams.get('tenantId') ?? undefined })
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('directory.errors.tenant_id_required', 'A tenantId is required') },
      { status: 400 },
    )
  }

  try {
    const service = await resolveService()
    const items = await service.listTenantModules(parsed.data.tenantId)
    return NextResponse.json({ items })
  } catch (err) {
    logger.error('Failed to list tenant modules', { err })
    return NextResponse.json(
      { error: translate('directory.errors.tenant_modules_load_failed', 'Failed to load tenant modules') },
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
      { error: translate('directory.errors.invalid_body', 'Invalid request body') },
      { status: 400 },
    )
  }

  const parsed = updateBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('directory.errors.invalid_body', 'Invalid request body') },
      { status: 400 },
    )
  }

  try {
    const container = await createRequestContainer()
    const commandBus = container.resolve('commandBus') as CommandBus
    // Routed through the command bus so the entitlement change lands in the
    // existing audit trail (actor, tenant, module, old value, new value) rather
    // than growing a second, parallel audit path.
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: null,
      request: req,
    }
    const { target, ...input } = parsed.data
    const commandId = target === 'aiAssistant'
      ? 'directory.tenant_modules.set_ai'
      : 'directory.tenant_modules.set'
    await commandBus.execute(commandId, { input, ctx })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('Failed to update tenant module entitlement', { err })
    return NextResponse.json(
      { error: translate('directory.errors.tenant_modules_save_failed', 'Failed to update module entitlement') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: directoryTag,
  summary: 'Tenant module entitlement',
  methods: {
    GET: {
      summary: 'List module entitlement for a tenant',
      description: 'Returns every entitleable module with whether the tenant is currently granted it.',
      responses: [
        { status: 200, description: 'Tenant module entitlement', schema: listResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing or invalid tenantId', schema: directoryErrorSchema },
        { status: 401, description: 'Unauthorized', schema: directoryErrorSchema },
        { status: 500, description: 'Failed to load tenant modules', schema: directoryErrorSchema },
      ],
    },
    PUT: {
      summary: 'Grant or withhold a module for a tenant',
      description: 'Records the tenant module entitlement. Platform infrastructure modules are rejected.',
      responses: [
        { status: 200, description: 'Entitlement updated', schema: directoryOkSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body or platform module', schema: directoryErrorSchema },
        { status: 401, description: 'Unauthorized', schema: directoryErrorSchema },
      ],
    },
  },
}
