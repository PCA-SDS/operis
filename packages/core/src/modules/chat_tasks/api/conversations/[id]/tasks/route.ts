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
  searchParamsToObject,
  toChatTasksErrorResponse,
} from '../../../shared'
import { chatTaskCreateRequestSchema, chatTaskLinkListQuerySchema } from '../../../../data/validators'
import type { CreateChatTaskInput, CreateChatTaskResult } from '../../../../commands/links'
import {
  CHAT_TASKS_TAG,
  COMMON_ERRORS,
  IDEMPOTENCY_ERRORS,
  WRITE_ERRORS,
  cardListSchema,
  createResultSchema,
} from '../../../openapi'

/**
 * Reading the panel needs both read grants; creating needs the task create grant
 * and, because a card is a write to the conversation, `chat.send`.
 *
 * Route metadata is the coarse gate — it can only express the union. Membership in
 * this particular conversation, and readability of each particular task, are
 * checked per record inside the service and the command.
 */
export const metadata = {
  /**
   * `chat.view` alone on the read, for the same reason the card route takes it: a
   * member with no task access still gets an answer — the honest count of how many
   * tasks are linked here that they cannot resolve. Refusing the request would tell
   * them nothing, and the per-task grant is checked per row inside the service.
   */
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  POST: { requireAuth: true, requireFeatures: ['chat.send', 'tasks.create'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = chatTaskLinkListQuerySchema.parse(searchParamsToObject(req.url))
    return jsonOk(
      await chatTaskService(request).listConversationLinks(readContext(request), id, query),
    )
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.conversations.tasks.list')
  }
}

export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatTasksRateLimit(request, chatTaskWriteRateLimit)
    if (limited) return limited

    const body = chatTaskCreateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const input: CreateChatTaskInput = {
      ...body,
      // Scope from the session, never from the body — a route that read it from
      // input would let a caller name somebody else's tenant.
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      conversationId: id,
    }

    const outcome = await runChatTasksCommand<CreateChatTaskInput, CreateChatTaskResult>({
      request,
      req,
      commandId: 'chat_tasks.links.createTask',
      input,
      resourceKind: 'chat_tasks.link',
      resourceId: id,
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    /**
     * The task is read back for THIS caller through the same authorized path a
     * card uses, rather than echoed from the command's own view. It is the caller's
     * own task so the read always succeeds, and going through one path means the
     * response cannot carry a field the card renderer would have hidden.
     */
    const task = await chatTaskService(request).requireReadableTask(
      readContext(request),
      outcome.result.taskId,
    )

    return jsonOk({
      taskId: outcome.result.taskId,
      linkId: outcome.result.linkId,
      cardPublished: outcome.result.cardPublished,
      cardMessageId: outcome.result.cardMessageId,
      replayed: outcome.result.replayed,
      task,
    })
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.conversations.tasks.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'Tasks linked to a conversation',
  methods: {
    GET: {
      summary: 'List the tasks explicitly linked to this conversation',
      description:
        'Only links recorded for this conversation — never inferred from a shared assignee, a shared project or a text match. Each row is resolved through an authorized task read for the calling viewer: a task the caller may not read comes back as `available: false` with no title, assignee, project or status. The counts cover only authorized results, plus how many rows the caller cannot resolve.',
      query: chatTaskLinkListQuerySchema,
      responses: [{ status: 200, description: 'A page of linked tasks.', schema: cardListSchema }],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Create a task from this conversation',
      description:
        'Creates a real task through the tasks module\'s own command, records the link, and posts a card. `idempotencyKey` is required and is scoped to the caller inside their tenant and organization: a retry with the same key and the same details returns the original result, the same key with different details is refused with `idempotency_key_reuse`, and a key whose first attempt has not finished is refused with `request_in_progress` rather than creating a second task. `cardPublished: false` with a real `taskId` means the task exists and its card does not — retry with `POST /api/chat_tasks/links/{linkId}/card`.',
      requestBody: { contentType: 'application/json', schema: chatTaskCreateRequestSchema },
      responses: [{ status: 200, description: 'The created task and its link.', schema: createResultSchema }],
      errors: [...WRITE_ERRORS, ...IDEMPOTENCY_ERRORS],
    },
  },
}
