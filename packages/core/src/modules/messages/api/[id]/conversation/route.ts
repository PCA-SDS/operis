import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { resolveMessageContext } from '../../../lib/routeHelpers'
import {
  conversationMutationResponseSchema,
  errorResponseSchema,
} from '../../openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['messages.view'] },
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const commandBus = ctx.container.resolve('commandBus') as CommandBus

  const guardResult = await runRouteMutationGuards({
    container: ctx.container,
    req,
    auth: { userId: scope.userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: 'messages.conversation',
      resourceId: params.id,
      operation: 'delete',
      mutationPayload: null,
    },
  })
  if (!guardResult.ok) {
    return Response.json(
      guardResult.errorBody,
      { status: guardResult.errorStatus },
    )
  }

  try {
    const { result, logEntry } = await commandBus.execute('messages.conversation.delete_for_actor', {
      input: {
        anchorMessageId: params.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
      ctx: {
        container: ctx.container,
        auth: ctx.auth ?? null,
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: scope.organizationId ? [scope.organizationId] : null,
        request: req,
      },
    })

    const response = Response.json(result)
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'messages.conversation',
      resourceId: params.id,
    })
    await guardResult.runAfterSuccess()
    return response
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Message not found') {
        return Response.json({ error: error.message }, { status: 404 })
      }
      if (error.message === 'Access denied') {
        return Response.json({ error: error.message }, { status: 403 })
      }
    }
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    DELETE: {
      summary: 'Delete conversation for current actor',
      responses: [
        { status: 200, description: 'Conversation deleted', schema: conversationMutationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
