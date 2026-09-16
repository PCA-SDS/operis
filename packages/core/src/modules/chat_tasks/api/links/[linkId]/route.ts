import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { searchParamsToObject } from '../../shared'
import {
  chatTaskService,
  chatTaskWriteRateLimit,
  enforceChatTasksRateLimit,
  jsonOk,
  readContext,
  resolveChatTasksRequest,
  runChatTasksCommand,
  toChatTasksErrorResponse,
} from '../../shared'
import type { UnlinkChatTaskInput, UnlinkChatTaskResult } from '../../../commands/links'
import { CHAT_TASKS_TAG, COMMON_ERRORS, WRITE_ERRORS, cardSchema, okSchema } from '../../openapi'

/**
 * Reading one card, and unlinking.
 *
 * `DELETE` takes `chat.view` rather than `chat.send`: unlinking removes this
 * module's own row, and when `removeCard=true` the chat command it delegates to
 * applies chat's own author-or-owner rule. It never deletes the task, and no
 * `tasks.delete` is asked for or accepted here.
 */
export const metadata = {
  /** `chat.view` alone, matching the card and panel reads it backs. */
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  /**
   * Unlinking keeps `tasks.view`.
   *
   * It is a write, and somebody should know what they are removing a reference to.
   * A member with no task access sees the row as unavailable and has nothing to
   * act on, which is the right dead end — the alternative would let them clear a
   * link they cannot identify.
   */
  DELETE: { requireAuth: true, requireFeatures: ['chat.view', 'tasks.view'] },
}

const paramsSchema = z.object({ linkId: z.string().uuid() })
const deleteQuerySchema = z.object({
  removeCard: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { linkId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    return jsonOk(await chatTaskService(request).cardForLink(readContext(request), linkId))
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.links.get')
  }
}

export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { linkId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatTasksRateLimit(request, chatTaskWriteRateLimit)
    if (limited) return limited

    const query = deleteQuerySchema.parse(searchParamsToObject(req.url))

    const outcome = await runChatTasksCommand<UnlinkChatTaskInput, UnlinkChatTaskResult>({
      request,
      req,
      commandId: 'chat_tasks.links.unlink',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        linkId,
        removeCard: query.removeCard,
      },
      resourceKind: 'chat_tasks.link',
      resourceId: linkId,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ ok: true, cardRemoved: outcome.result.cardRemoved })
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.links.unlink')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'One conversation-to-task link',
  methods: {
    GET: {
      summary: 'Read one card',
      description:
        'Resolved for the calling viewer. A viewer without task access receives `available: false` and no task details.',
      responses: [{ status: 200, description: 'The card.', schema: cardSchema }],
      errors: [...COMMON_ERRORS],
    },
    DELETE: {
      summary: 'Unlink the task from the conversation',
      description:
        'Removes the link. With `?removeCard=true` the card row is also taken out of the transcript, through chat\'s own command so its author-or-owner rule applies. **The task itself is never deleted, and deleting a task or a conversation never deletes a link** — there is no foreign key for a cascade to travel down.',
      responses: [{ status: 200, description: 'Unlinked.', schema: okSchema }],
      errors: [...WRITE_ERRORS],
    },
  },
}
