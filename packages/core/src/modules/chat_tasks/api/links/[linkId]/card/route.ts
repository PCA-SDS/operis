import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  chatTaskWriteRateLimit,
  enforceChatTasksRateLimit,
  jsonOk,
  resolveChatTasksRequest,
  runChatTasksCommand,
  toChatTasksErrorResponse,
} from '../../../shared'
import type {
  PublishChatTaskCardInput,
  PublishChatTaskCardResult,
} from '../../../../commands/links'
import { CHAT_TASKS_TAG, WRITE_ERRORS } from '../../../openapi'

/**
 * The recovery path for a task whose card was not posted.
 *
 * `chat.send`, because posting a card writes to the conversation. It creates no
 * task, so retrying it cannot duplicate work — which is the whole point: the
 * create flow reports `cardPublished: false` honestly and points here rather than
 * re-running a create that would mint a second task.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.send', 'tasks.view'] },
}

const paramsSchema = z.object({ linkId: z.string().uuid() })

export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { linkId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatTasksRateLimit(request, chatTaskWriteRateLimit)
    if (limited) return limited

    const outcome = await runChatTasksCommand<PublishChatTaskCardInput, PublishChatTaskCardResult>({
      request,
      req,
      commandId: 'chat_tasks.cards.publish',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        linkId,
      },
      resourceKind: 'chat_tasks.link',
      resourceId: linkId,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ cardMessageId: outcome.result.cardMessageId })
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.cards.publish')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'Post the card for an existing link',
  methods: {
    POST: {
      summary: 'Publish, or re-publish, a task card',
      description:
        'For the case where the task was created and its card was not. Refuses when a card already exists rather than posting a second one, and never creates a task.',
      responses: [
        {
          status: 200,
          description: 'The card row.',
          schema: z.object({ cardMessageId: z.string().uuid() }),
        },
      ],
      errors: [...WRITE_ERRORS],
    },
  },
}
