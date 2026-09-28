import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { CustomerPipeline } from '../../data/entities'
import {
  pipelineCreateSchema,
  pipelineUpdateSchema,
  pipelineDeleteSchema,
  type PipelineCreateInput,
  type PipelineUpdateInput,
  type PipelineDeleteInput,
} from '../../data/validators'
import { withScopedPayload } from '../utils'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { buildPipelineRouteContext } from './context'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const logger = createLogger('customers')

const PIPELINE_RESOURCE_KIND = 'customers.pipeline'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.pipelines.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
}

export async function GET(req: Request) {
  try {
    const { ctx, tenantId, translate } = await buildPipelineRouteContext(req)
    if (!tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const orgFilter = resolveOrganizationScopeFilter(ctx.organizationScope, ctx.auth)
    const url = new URL(req.url)
    const isDefaultParam = url.searchParams.get('isDefault')

    const em = (ctx.container.resolve('em') as EntityManager)
    const where: Record<string, unknown> = { tenantId, ...orgFilter.where }
    if (isDefaultParam === 'true') where.isDefault = true
    if (isDefaultParam === 'false') where.isDefault = false

    const pipelines = await em.find(CustomerPipeline, where, { orderBy: { createdAt: 'ASC' } })
    const items = pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: pipeline.isDefault,
      organizationId: pipeline.organizationId,
      tenantId: pipeline.tenantId,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
    }))
    return NextResponse.json({ items, total: items.length })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('customers.pipelines GET failed', { err })
    return NextResponse.json({ error: 'Failed to load pipelines' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildPipelineRouteContext(req)
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const body = await readJsonSafe(req, {})
    const scoped = withScopedPayload(body, ctx, translate)
    const input = pipelineCreateSchema.parse(scoped)

    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId: ctx.auth!.sub, tenantId, organizationId },
      input: {
        resourceKind: PIPELINE_RESOURCE_KIND,
        resourceId: organizationId,
        operation: 'create',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<PipelineCreateInput, { pipelineId: string }>(
      'customers.pipelines.create',
      { input, ctx },
    )
    await guardResult.runAfterSuccess({ resourceId: result?.pipelineId ?? organizationId })
    const response = NextResponse.json({ id: result?.pipelineId ?? null }, { status: 201 })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'customers.pipeline',
      resourceId: result?.pipelineId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('customers.pipelines POST failed', { err })
    return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildPipelineRouteContext(req)
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const body = await readJsonSafe(req, {})
    const scoped = withScopedPayload(body, ctx, translate)
    const input = pipelineUpdateSchema.parse(scoped)

    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId: ctx.auth!.sub, tenantId, organizationId },
      input: {
        resourceKind: PIPELINE_RESOURCE_KIND,
        resourceId: input.id,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { logEntry } = await commandBus.execute<PipelineUpdateInput, void>(
      'customers.pipelines.update',
      { input, ctx },
    )
    await guardResult.runAfterSuccess()
    const response = NextResponse.json({ ok: true })
    attachOperationMetadataHeader(response, logEntry, { resourceKind: 'customers.pipeline' })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('customers.pipelines PUT failed', { err })
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildPipelineRouteContext(req)
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const body = await readJsonSafe(req, {})
    const scoped = withScopedPayload(body, ctx, translate)
    const input = pipelineDeleteSchema.parse(scoped)

    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId: ctx.auth!.sub, tenantId, organizationId },
      input: {
        resourceKind: PIPELINE_RESOURCE_KIND,
        resourceId: input.id,
        operation: 'delete',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    await commandBus.execute<PipelineDeleteInput, void>(
      'customers.pipelines.delete',
      { input, ctx },
    )
    await guardResult.runAfterSuccess()
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('customers.pipelines DELETE failed', { err })
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 400 })
  }
}

const pipelineItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const pipelineListResponseSchema = z.object({
  items: z.array(pipelineItemSchema),
  total: z.number(),
})

const pipelineCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

const pipelineOkResponseSchema = z.object({
  ok: z.boolean(),
})

const pipelineErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Manage customer pipelines',
  methods: {
    GET: {
      summary: 'List pipelines',
      description: 'Returns a list of pipelines scoped to the authenticated organization.',
      query: z.object({ isDefault: z.string().optional() }),
      responses: [
        { status: 200, description: 'Pipeline list', schema: pipelineListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: pipelineErrorSchema },
        { status: 400, description: 'Invalid request', schema: pipelineErrorSchema },
      ],
    },
    POST: {
      summary: 'Create pipeline',
      description: 'Creates a new pipeline within the authenticated organization.',
      requestBody: { contentType: 'application/json', schema: pipelineCreateSchema },
      responses: [
        { status: 201, description: 'Pipeline created', schema: pipelineCreateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: pipelineErrorSchema },
        { status: 401, description: 'Unauthorized', schema: pipelineErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update pipeline',
      description: 'Updates an existing pipeline.',
      requestBody: { contentType: 'application/json', schema: pipelineUpdateSchema },
      responses: [
        { status: 200, description: 'Pipeline updated', schema: pipelineOkResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: pipelineErrorSchema },
        { status: 404, description: 'Pipeline not found', schema: pipelineErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete pipeline',
      description: 'Deletes a pipeline. Returns 409 if active deals exist.',
      requestBody: { contentType: 'application/json', schema: pipelineDeleteSchema },
      responses: [
        { status: 200, description: 'Pipeline deleted', schema: pipelineOkResponseSchema },
      ],
      errors: [
        { status: 409, description: 'Pipeline has active deals', schema: pipelineErrorSchema },
        { status: 404, description: 'Pipeline not found', schema: pipelineErrorSchema },
      ],
    },
  },
}
