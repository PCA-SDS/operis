import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexOkSchema, queryIndexPurgeRequestSchema } from './openapi'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['query_index.purge'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await readJsonSafe(req, {}) as any
  const entityType = String(body?.entityType || '')
  if (!entityType) return NextResponse.json({ error: 'Missing entityType' }, { status: 400 })

  const container = await createRequestContainer()
  let em: any | null = null
  try {
    em = container.resolve('em')
  } catch {}
  const bus = container.resolve('eventBus') as any

  const guardUserId = typeof auth.sub === 'string' ? auth.sub : ''
  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: guardUserId, tenantId: auth.tenantId, organizationId: auth.orgId },
    input: {
      resourceKind: 'query_index',
      resourceId: entityType,
      operation: 'custom',
      mutationPayload: { entityType },
    },
  })
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
  }

  await recordIndexerLog(
    { em: em ?? undefined },
    {
      source: 'query_index',
      handler: 'api:query_index.purge',
      message: `Purge requested for ${entityType}`,
      entityType,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    },
  ).catch(() => undefined)
  try {
    await bus.emitEvent(
      'query_index.purge',
      { entityType, organizationId: auth.orgId, tenantId: auth.tenantId },
      { persistent: true, deliverInline: false },
    )
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'query_index',
        handler: 'api:query_index.purge',
        message: `Purge queued for ${entityType}`,
        entityType,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      },
    ).catch(() => undefined)
    await guardResult.runAfterSuccess()
  } catch (error) {
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'query_index',
        handler: 'api:query_index.purge',
        level: 'warn',
        message: `Failed to queue purge for ${entityType}`,
        entityType,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { error: error instanceof Error ? error.message : String(error) },
      },
    ).catch(() => undefined)
    throw error
  }
  return NextResponse.json({ ok: true })
}

const queryIndexPurgeDoc: OpenApiMethodDoc = {
  summary: 'Purge query index records',
  description: 'Queues a purge job to remove indexed records for an entity type within the active scope.',
  tags: [queryIndexTag],
  requestBody: {
    contentType: 'application/json',
    schema: queryIndexPurgeRequestSchema,
    description: 'Entity identifier whose index entries should be removed.',
  },
  responses: [
    { status: 200, description: 'Purge job accepted.', schema: queryIndexOkSchema },
  ],
  errors: [
    { status: 400, description: 'Missing entity type', schema: queryIndexErrorSchema },
    { status: 401, description: 'Authentication required', schema: queryIndexErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: queryIndexTag,
  summary: 'Queue a query index purge',
  methods: {
    POST: queryIndexPurgeDoc,
  },
}
