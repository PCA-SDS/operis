import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  chatTaskService,
  chatTaskWriteRateLimit,
  enforceChatTasksRateLimit,
  jsonOk,
  readContext,
  resolveChatTasksRequest,
  runChatTasksCommand,
  toChatTasksErrorResponse,
} from '../../../shared'
import { chatTaskLinkRequestSchema } from '../../../../data/validators'
import type { LinkChatTaskInput, LinkChatTaskResult } from '../../../../commands/links'
import { CHAT_TASKS_TAG, WRITE_ERRORS, linkResultSchema } from '../../../openapi'

/**
 * Linking an existing task, with a card by default.
 *
 * `chat.send` because the default posts to the conversation, and `tasks.view`
 * rather than `tasks.create` because nothing is created — the caller must be able
 * to read the task they are putting in front of their colleagues, which is checked
 * per task inside the command.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.send', 'tasks.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatTasksRateLimit(request, chatTaskWriteRateLimit)
    if (limited) return limited

    const body = chatTaskLinkRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runChatTasksCommand<LinkChatTaskInput, LinkChatTaskResult>({
      request,
      req,
      commandId: 'chat_tasks.links.linkExisting',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        taskId: body.taskId,
        sourceMessageId: body.sourceMessageId ?? null,
        publishCard: body.publishCard,
      },
      resourceKind: 'chat_tasks.link',
      resourceId: id,
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const task = await chatTaskService(request).requireReadableTask(readContext(request), body.taskId)
    return jsonOk({
      linkId: outcome.result.linkId,
      cardPublished: outcome.result.cardPublished,
      cardMessageId: outcome.result.cardMessageId,
      task,
    })
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.conversations.links.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'Link an existing task to a conversation',
  methods: {
    POST: {
      summary: 'Link a task the caller can already read',
      description:
        'Both boundaries are checked: the caller must be a member of the conversation AND able to read the task. Linking the same task twice converges on the one link rather than stacking cards — a double click is not a conflict.',
      requestBody: { contentType: 'application/json', schema: chatTaskLinkRequestSchema },
      responses: [{ status: 200, description: 'The link and its card.', schema: linkResultSchema }],
      errors: [...WRITE_ERRORS],
    },
  },
}
