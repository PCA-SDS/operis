import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { deleteUserPerspective } from '../../../services/perspectiveService'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { perspectivesTag, perspectivesErrorSchema, perspectivesSuccessSchema } from '../../openapi'
import { decodeParam } from '../params'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['perspectives.use'] },
}

export async function DELETE(req: Request, ctx: { params: { tableId: string; perspectiveId: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  const perspectiveId = decodeParam(ctx.params?.perspectiveId).trim()
  if (!tableId || !perspectiveId) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const cache = ((): import('@open-mercato/cache').CacheStrategy | null => {
    try {
      return container.resolve('cache') as import('@open-mercato/cache').CacheStrategy
    } catch {
      return null
    }
  })()

  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub, tenantId: auth.tenantId ?? '', organizationId: auth.orgId ?? null },
    input: {
      resourceKind: 'perspectives.perspective',
      resourceId: perspectiveId,
      operation: 'delete',
      mutationPayload: { tableId, perspectiveId },
    },
  })
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
  }

  let deleted = false
  try {
    deleted = await deleteUserPerspective(em, cache, {
      scope: {
        userId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      },
      tableId,
      perspectiveId,
      request: req,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  if (deleted) {
    await guardResult.runAfterSuccess()
  }

  return NextResponse.json({ success: true })
}

const perspectiveDeletePathParamsSchema = z.object({
  tableId: z.string().min(1),
  perspectiveId: z.string().uuid(),
})

const perspectiveDeleteDoc: OpenApiMethodDoc = {
  summary: 'Delete a personal perspective',
  description: 'Removes a perspective owned by the current user for the given table.',
  tags: [perspectivesTag],
  responses: [
    { status: 200, description: 'Perspective removed.', schema: perspectivesSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid identifiers supplied', schema: perspectivesErrorSchema },
    { status: 401, description: 'Authentication required', schema: perspectivesErrorSchema },
    { status: 409, description: 'Optimistic lock conflict', schema: perspectivesErrorSchema },
    { status: 404, description: 'Perspective not found', schema: perspectivesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: perspectivesTag,
  summary: 'Delete personal perspective',
  pathParams: perspectiveDeletePathParamsSchema,
  methods: {
    DELETE: perspectiveDeleteDoc,
  },
}
