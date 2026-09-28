import { NextResponse } from 'next/server'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import {
  resourcesResourceTagAssignmentSchema,
  type ResourcesResourceTagAssignmentInput,
} from '../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { buildResourceTagRouteContext } from './context'
import { resolveAuthActorId } from '@open-mercato/shared/lib/auth/actor'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const logger = createLogger('resources').child({ component: 'tags' })

export type ResourceTagChange = {
  commandId: 'resources.resourceTags.assign' | 'resources.resourceTags.unassign'
  successStatus: 200 | 201
  failureLog: string
}

export async function changeResourceTag(req: Request, change: ResourceTagChange): Promise<NextResponse> {
  try {
    const { ctx, translate } = await buildResourceTagRouteContext(req)
    const body = await readJsonSafe(req, {})
    const input = parseScopedCommandInput(resourcesResourceTagAssignmentSchema, body, ctx, translate)
    const actorId = resolveAuthActorId(ctx.auth)
    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId: actorId, tenantId: input.tenantId, organizationId: input.organizationId },
      input: {
        resourceKind: 'resources.resourceTagAssignment',
        resourceId: input.resourceId,
        operation: 'custom',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<ResourcesResourceTagAssignmentInput, { assignmentId: string | null }>(
      change.commandId,
      { input, ctx },
    )
    await guardResult.runAfterSuccess()

    const response = NextResponse.json({ id: result?.assignmentId ?? null }, { status: change.successStatus })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'resources.resourceTagAssignment',
      resourceId: result?.assignmentId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error(change.failureLog, { err })
    return NextResponse.json({ error: translate('resources.resources.tags.updateError', 'Failed to update tags.') }, { status: 400 })
  }
}
