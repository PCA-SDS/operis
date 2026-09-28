import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { resolveMessageContext } from '../../../lib/routeHelpers'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

export type ConversationActorCommandId =
  | 'messages.conversation.archive_for_actor'
  | 'messages.conversation.unarchive_for_actor'
  | 'messages.conversation.mark_read_for_actor'
  | 'messages.conversation.mark_unread_for_actor'

export async function runConversationActorMutation(
  req: Request,
  id: string,
  commandId: ConversationActorCommandId,
) {
  const { ctx, scope } = await resolveMessageContext(req)
  const commandBus = ctx.container.resolve('commandBus') as CommandBus

  const guardResult = await runRouteMutationGuards({
    container: ctx.container,
    req,
    auth: { userId: scope.userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: 'messages.conversation',
      resourceId: id,
      operation: 'update',
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
    const { result, logEntry } = await commandBus.execute(commandId, {
      input: {
        anchorMessageId: id,
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
      resourceId: id,
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
