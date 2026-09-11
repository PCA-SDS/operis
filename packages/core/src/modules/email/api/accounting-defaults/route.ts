import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { EmailAccountingDefaults } from '../../data/entities'
import { emailAccountingDefaultsSchema } from '../../data/validators'
import { createEmailOperationId, emailCommonErrors, emailSettingsTag } from '../openapi'

const logger = createLogger('email').child({ component: 'api/accounting-defaults' })
const RESOURCE_KIND = 'email.accounting_defaults'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['email.accounting_defaults.view'] },
  PUT: { requireAuth: true, requireFeatures: ['email.accounting_defaults.manage'] },
}

function serialize(defaults: EmailAccountingDefaults) {
  return {
    id: defaults.id,
    default_sender_name: defaults.defaultSenderName ?? null,
    default_reply_to: defaults.defaultReplyTo ?? null,
    placeholders: defaults.placeholders,
    link_placeholders: defaults.linkPlaceholders,
    rules: defaults.rules,
    tenant_id: defaults.tenantId,
    organization_id: defaults.organizationId,
    createdAt: defaults.createdAt.toISOString(),
    updatedAt: defaults.updatedAt.toISOString(),
  }
}

async function resolveContext(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.sub) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!auth.tenantId) {
    return { error: NextResponse.json({ error: 'Tenant and organization context required' }, { status: 400 }) }
  }
  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return { error: NextResponse.json({ error: 'Tenant and organization context required' }, { status: 400 }) }
  }
  return { auth, container, tenantId: auth.tenantId, organizationId }
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

export async function GET(req: Request) {
  const ctx = await resolveContext(req)
  if ('error' in ctx) return ctx.error
  const em = ctx.container.resolve('em') as EntityManager
  const defaults = await em.findOne(EmailAccountingDefaults, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
  if (!defaults) {
    return NextResponse.json({
      id: null,
      default_sender_name: null,
      default_reply_to: null,
      placeholders: {},
      link_placeholders: {},
      rules: {},
      tenant_id: ctx.tenantId,
      organization_id: ctx.organizationId,
      createdAt: null,
      updatedAt: null,
    })
  }
  return NextResponse.json(serialize(defaults))
}

export async function PUT(req: Request) {
  const ctx = await resolveContext(req)
  if ('error' in ctx) return ctx.error

  const parsed = emailAccountingDefaultsSchema.safeParse(await readJsonSafe(req, {}))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let defaults = await em.findOne(EmailAccountingDefaults, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    const guardInput: MutationGuardInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.auth.sub,
      resourceKind: RESOURCE_KIND,
      resourceId: defaults?.id ?? null,
      operation: defaults ? 'update' : 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data,
    }
    const legacyGuard = bridgeLegacyGuard(ctx.container)
    const guardResult = legacyGuard
      ? await runMutationGuards([legacyGuard], guardInput, { userFeatures: resolveUserFeatures(ctx.auth) })
      : { ok: true, afterSuccessCallbacks: [] as Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }> }
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked' }, { status: guardResult.errorStatus ?? 422 })
    }
    const guardedData = guardResult.modifiedPayload
      ? emailAccountingDefaultsSchema.parse({ ...parsed.data, ...guardResult.modifiedPayload })
      : parsed.data

    if (defaults) {
      assertOptimisticLock({
        resourceKind: 'email.accounting_defaults',
        resourceId: defaults.id,
        expected: guardedData.expected_updated_at,
        current: defaults.updatedAt,
      })
      defaults.defaultSenderName = guardedData.default_sender_name ?? null
      defaults.defaultReplyTo = guardedData.default_reply_to ?? null
      defaults.placeholders = guardedData.placeholders
      defaults.linkPlaceholders = guardedData.link_placeholders
      defaults.rules = guardedData.rules
    } else {
      defaults = em.create(EmailAccountingDefaults, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        defaultSenderName: guardedData.default_sender_name ?? null,
        defaultReplyTo: guardedData.default_reply_to ?? null,
        placeholders: guardedData.placeholders,
        linkPlaceholders: guardedData.link_placeholders,
        rules: guardedData.rules,
      })
      em.persist(defaults)
    }
    await em.flush()
    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({
          ...guardInput,
          resourceId: defaults.id,
          metadata: callback.metadata ?? null,
        })
      } catch (err) {
        logger.warn('Mutation guard afterSuccess callback failed', { err })
      }
    }
    return NextResponse.json(serialize(defaults))
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    throw error
  }
}

const accountingDefaultsResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  default_sender_name: z.string().nullable(),
  default_reply_to: z.string().nullable(),
  placeholders: z.record(z.string(), z.unknown()),
  link_placeholders: z.record(z.string(), z.unknown()),
  rules: z.record(z.string(), z.unknown()),
  tenant_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: emailSettingsTag,
  description: 'Reads or replaces accounting email defaults scoped to the authenticated tenant and organization.',
  methods: {
    GET: {
      operationId: createEmailOperationId('accountingDefaults', 'read'),
      summary: 'Read accounting email defaults',
      responses: [
        { status: 200, description: 'Accounting email defaults', schema: accountingDefaultsResponseSchema },
        ...emailCommonErrors,
      ],
    },
    PUT: {
      operationId: createEmailOperationId('accountingDefaults', 'update'),
      summary: 'Update accounting email defaults',
      requestBody: { schema: emailAccountingDefaultsSchema },
      responses: [
        { status: 200, description: 'Accounting email defaults', schema: accountingDefaultsResponseSchema },
        ...emailCommonErrors,
      ],
    },
  },
}
