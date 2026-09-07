import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  resourcesResourceAreaReorderSchema,
  type ResourcesResourceAreaReorderInput,
} from '../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('resources').child({ component: 'resource-areas-reorder-api' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['resources.areas.manage'] },
}

export async function POST(req: Request) {
  const container = await createRequestContainer()
  try {
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) return NextResponse.json({ error: translate('resources.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }
    const tenantId = auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      return NextResponse.json({ error: translate('resources.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }

    const input = parseScopedCommandInput(
      resourcesResourceAreaReorderSchema,
      await readJsonSafe(req, {}),
      ctx,
      translate,
    )
    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: 'resources.resourceArea',
      resourceId: input.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute<ResourcesResourceAreaReorderInput, { updatedIds: string[] }>(
      'resources.resourceAreas.reorder',
      { input, ctx },
    )
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: 'resources.resourceArea',
        resourceId: input.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to reorder resource areas', { err })
    return NextResponse.json({ error: 'Failed to reorder resource areas' }, { status: 400 })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

const reorderResponseSchema = z.object({ ok: z.boolean() })
const reorderErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Resources',
  summary: 'Reorder resource areas',
  methods: {
    POST: {
      summary: 'Reorder resource areas',
      description: 'Moves a resource area relative to its siblings.',
      requestBody: { contentType: 'application/json', schema: resourcesResourceAreaReorderSchema },
      responses: [
        { status: 200, description: 'Resource areas reordered.', schema: reorderResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: reorderErrorSchema },
        { status: 401, description: 'Unauthorized', schema: reorderErrorSchema },
      ],
    },
  },
}
