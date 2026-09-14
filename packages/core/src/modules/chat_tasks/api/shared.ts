// The plumbing every chat_tasks route repeats: resolve the caller, pin the
// request to one tenant + organization, rate limit writes by user, run the
// mutation guard, and turn thrown domain errors into the right HTTP status.
//
// A near-twin of `chat/api/shared.ts` and `tasks/api/shared.ts` on purpose: this
// module sits between them and has to behave identically to both, and a shared
// abstraction over all three would have to know which module's error copy and
// which module's rate limits to use.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { loadChatTasksMessages, type ChatTasksMessages } from '../lib/messages'
import type { ChatTasksScope } from '../lib/scope'
import type { ChatTaskReadContext, ChatTaskService } from '../services/chatTaskService'
import type { ChatTaskAssignmentService } from '../services/chatTaskAssignmentService'

const logger = createLogger('chat_tasks')

/**
 * Creating a task from chat writes to two modules and posts to a conversation.
 *
 * Tighter than chat's own send limit because the work behind one call is larger,
 * and `failClosed` because an uncounted write here is exactly what the limit
 * exists to stop — a loop that mints tasks faster than anyone can delete them.
 */
export const chatTaskWriteRateLimit = readEndpointRateLimitConfig('CHAT_TASKS_WRITE', {
  points: 30,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'chat_tasks_write',
})

export type ChatTasksRequestContext = {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  em: EntityManager
  scope: ChatTasksScope
  userId: string
  messages: ChatTasksMessages
  ctx: CommandRuntimeContext
}

/**
 * Resolve the request into a scoped context, or return the response to send.
 *
 * Fails closed. No tenant or no subject is a 401; an organization scope that
 * cannot be resolved is a 400, never a 401 — `apiFetch` reads 401 as an expired
 * session and would loop through the refresh endpoint forever.
 *
 * Scope comes from the verified session and nowhere else. A tenant or
 * organization id in a body or a query string is never read.
 */
export async function resolveChatTasksRequest(
  req: Request,
): Promise<{ ok: true; value: ChatTasksRequestContext } | { ok: false; response: Response }> {
  const messages = await loadChatTasksMessages()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.sub) {
    return { ok: false, response: NextResponse.json({ error: messages.unauthorized }, { status: 401 }) }
  }

  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { ok: false, response: organizationScopeRequiredResponse() }

  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })

  return {
    ok: true,
    value: {
      container,
      auth,
      em: container.resolve('em') as EntityManager,
      scope: { tenantId: auth.tenantId, organizationId },
      userId: auth.sub,
      messages,
      ctx: {
        container,
        auth,
        organizationScope,
        selectedOrganizationId: organizationId,
        organizationIds: organizationScope?.filterIds ?? [organizationId],
        request: req,
      },
    },
  }
}

export function chatTaskService(request: ChatTasksRequestContext): ChatTaskService {
  return request.container.resolve('chatTaskService') as ChatTaskService
}

export function chatTaskAssignmentService(request: ChatTasksRequestContext): ChatTaskAssignmentService {
  return request.container.resolve('chatTaskAssignmentService') as ChatTaskAssignmentService
}

export function readContext(request: ChatTasksRequestContext): ChatTaskReadContext {
  return {
    container: request.container,
    em: request.em,
    scope: request.scope,
    userId: request.userId,
  }
}

/** Keyed on the authenticated subject inside their tenant, so a header cannot spoof it. */
export async function enforceChatTasksRateLimit(
  request: ChatTasksRequestContext,
  config: RateLimitConfig,
): Promise<Response | null> {
  const rateLimiterService = getCachedRateLimiterService()
  if (!rateLimiterService) {
    logger.error('Rate limiter service is not registered — check RATE_LIMIT_* configuration', {
      keyPrefix: config.keyPrefix,
    })
    // An absent limiter is the same condition as an unreachable one: the request
    // cannot be counted, and this is a write.
    return NextResponse.json({ error: request.messages.internal }, { status: 503 })
  }
  return checkRateLimit(
    rateLimiterService,
    config,
    `${request.scope.tenantId}:${request.userId}`,
    request.messages.internal,
    { failClosed: true, unavailableMessage: request.messages.internal },
  )
}

export type ChatTasksMutationOperation = 'create' | 'update' | 'delete'

/**
 * Execute a command through the bus with the mutation-guard contract wired in.
 * A write that skips this silently opts out of record locks and every future
 * global guard.
 */
export async function runChatTasksCommand<TInput, TResult>(options: {
  request: ChatTasksRequestContext
  req: Request
  commandId: string
  input: TInput
  resourceKind: string
  resourceId?: string | null
  operation: ChatTasksMutationOperation
}): Promise<{ ok: true; result: TResult } | { ok: false; response: Response }> {
  const { request, req, commandId, input, resourceKind, resourceId, operation } = options

  const guard = await runRouteMutationGuards({
    container: request.container,
    req,
    auth: {
      userId: request.userId,
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
    },
    input: {
      resourceKind,
      resourceId: resourceId ?? null,
      operation,
      mutationPayload: input as Record<string, unknown>,
    },
  })
  if (!guard.ok) return { ok: false, response: guard.response }

  const effectiveInput = (guard.modifiedPayload ? { ...input, ...guard.modifiedPayload } : input) as TInput
  const commandBus = request.container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute<TInput, TResult>(commandId, {
    input: effectiveInput,
    ctx: request.ctx,
  })

  await guard.runAfterSuccess()

  /**
   * Drop what this request had loaded, now the command has committed.
   *
   * Commands run on their own fork, so rows they changed are updated in a
   * different identity map from `request.em` — and every route here reads the
   * record back through `request.em` to build its response. Without this the
   * write lands in the database while the response describes the row as it was
   * before it. The tasks module hit exactly this and fixed it the same way.
   */
  request.em.clear()

  return { ok: true, result }
}

/** Domain errors carry their own HTTP shape; zod failures are a 400; the rest is a logged 500. */
export async function toChatTasksErrorResponse(error: unknown, route: string): Promise<Response> {
  const messages = await loadChatTasksMessages()
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: messages.validationFailed, details: error.issues }, { status: 400 })
  }
  logger.error(`${route} failed`, { err: error })
  return NextResponse.json({ error: messages.internal }, { status: 500 })
}

/** Query params as a plain record, so a zod schema can coerce them. */
export function searchParamsToObject(url: string): Record<string, string> {
  const params = new URL(url).searchParams
  const result: Record<string, string> = {}
  for (const [key, value] of params.entries()) result[key] = value
  return result
}

export function jsonOk<T>(body: T): Response {
  return NextResponse.json(body)
}
