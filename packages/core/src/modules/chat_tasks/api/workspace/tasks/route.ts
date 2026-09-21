import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { MyTasksService } from '@open-mercato/core/modules/tasks/services/myTasksService'
import { myTasksQuerySchema } from '@open-mercato/core/modules/tasks/data/validators'
import {
  pagedSchema as tasksPagedSchema,
  taskListItemSchema,
} from '@open-mercato/core/modules/tasks/api/openapi'
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
} from '../../shared'
import { chatTaskWorkspaceCreateRequestSchema } from '../../../data/validators'
import type { CreateChatTaskInput, CreateChatTaskResult } from '../../../commands/links'
import {
  CHAT_TASKS_TAG,
  COMMON_ERRORS,
  IDEMPOTENCY_ERRORS,
  WRITE_ERRORS,
  cardTaskSchema,
} from '../../openapi'

/**
 * The personal workspace, which is not a conversation.
 *
 * There is no `chat.*` grant here and no conversation id anywhere in the flow.
 * That is the design: the workspace is an isolated surface whose identity IS the
 * (user, tenant, organization) triple, so there is no row for another person to
 * read, no participant list to get wrong, no unread state, no notification and
 * nothing for the Matrix transport to provision. "One workspace per user per
 * tenant and organization" is true by construction rather than enforced, and
 * concurrent creation cannot race because nothing is created.
 *
 * What it is NOT is a place where tasks become private. A task made here has
 * exactly the visibility every other task in the organization has, and the
 * composer says so — see `chat_tasks.workspace.sharedNotice`.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.create'] },
}

/**
 * The query this route accepts — the `assigned` view's, minus the view itself.
 *
 * `view` is pinned server-side rather than taken from the caller: the workspace is
 * "tasks assigned to me", and letting a query parameter switch it to `all` would
 * turn a personal surface into an organization-wide one by accident.
 */
const workspaceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
  tz: z.string().min(1).max(80).optional(),
})

export async function GET(req: Request) {
  try {
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    /**
     * The tasks module's own `assigned` view, not a reimplementation.
     *
     * That view is the only one of the five that actually filters by assignment,
     * and it resolves a role audience at read time — so somebody added to a role
     * this morning sees that role's tasks here without anything being rewritten.
     * Re-deriving the filter would be a second definition of "mine" that could
     * drift from the one the Tasks screens use.
     */
    const query = myTasksQuerySchema.parse({
      ...searchParamsToObject(req.url),
      view: 'assigned',
    })
    const service = request.container.resolve('tasksMyTasksService') as MyTasksService
    return jsonOk(await service.list(request.em, request.scope, request.userId, query))
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.workspace.tasks.list')
  }
}

export async function POST(req: Request) {
  try {
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatTasksRateLimit(request, chatTaskWriteRateLimit)
    if (limited) return limited

    const body = chatTaskWorkspaceCreateRequestSchema.parse(
      await readJsonSafe<Record<string, unknown>>(req, {}),
    )

    const outcome = await runChatTasksCommand<CreateChatTaskInput, CreateChatTaskResult>({
      request,
      req,
      commandId: 'chat_tasks.links.createTask',
      input: {
        ...body,
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        // No conversation, so no link and no card. The command's assignee
        // resolution reads this as "the personal workspace" and defaults the
        // assignee to the caller.
        conversationId: null,
        sourceMessageId: null,
        publishCard: false,
      },
      resourceKind: 'chat_tasks.workspace_task',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const task = await chatTaskService(request).requireReadableTask(
      readContext(request),
      outcome.result.taskId,
    )
    return jsonOk({ taskId: outcome.result.taskId, replayed: outcome.result.replayed, task })
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.workspace.tasks.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'The caller’s own workspace tasks',
  methods: {
    GET: {
      summary: 'List tasks assigned to the caller',
      description:
        "Delegates to the tasks module's `assigned` view, so direct assignment and role audiences behave exactly as they do on the Tasks screens. No chat grant is required — reading your own task list is not an act in any conversation.",
      query: workspaceListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'A page of the caller’s assigned tasks.',
          // The tasks module's own list shape, imported rather than restated:
          // this route returns exactly what `/api/tasks/my-tasks` returns.
          schema: tasksPagedSchema(taskListItemSchema),
        },
      ],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Create a task for yourself',
      description:
        'No conversation, no link and no card. The assignee defaults to the caller, so `tasks.assign` is not required unless they name somebody else. The task has normal task-module visibility — creating it here makes it no more private than any other task.',
      requestBody: { contentType: 'application/json', schema: chatTaskWorkspaceCreateRequestSchema },
      responses: [
        {
          status: 200,
          description: 'The created task.',
          schema: z.object({
            taskId: z.string().uuid(),
            replayed: z.boolean(),
            task: cardTaskSchema,
          }),
        },
      ],
      errors: [...WRITE_ERRORS, ...IDEMPOTENCY_ERRORS],
    },
  },
}
