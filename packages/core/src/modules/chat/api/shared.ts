// The plumbing every chat route repeats: resolve the caller, pin the request to
// one tenant + organization, rate limit by user, run the mutation guard, and turn
// thrown domain errors into the right HTTP status.

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
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { checkRateLimit } from '@open-mercato/shared/lib/ratelimit/helpers'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { loadChatMessages, type ChatMessages } from '../lib/messages'
import type { ChatScope } from '../lib/scope'
import type { ChatReadContext, ChatService } from '../services/chatService'

const logger = createLogger('chat')

export type ChatRequestContext = {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  em: EntityManager
  scope: ChatScope
  userId: string
  messages: ChatMessages
  ctx: CommandRuntimeContext
}

/**
 * Resolve the request into a scoped context, or return the response to send
 * instead.
 *
 * Fails closed. No tenant or no subject is a 401; an organization scope that
 * cannot be resolved is a 400, never a 401 — `apiFetch` reads 401 as an expired
 * session and would loop through the refresh endpoint forever.
 */
export async function resolveChatRequest(
  req: Request,
): Promise<{ ok: true; value: ChatRequestContext } | { ok: false; response: Response }> {
  const messages = await loadChatMessages()
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

export function chatService(request: ChatRequestContext): ChatService {
  return request.container.resolve('chatService') as ChatService
}

export function readContext(request: ChatRequestContext): ChatReadContext {
  return { em: request.em, scope: request.scope, userId: request.userId }
}

/**
 * Rate limit keyed on the authenticated subject inside their tenant.
 *
 * The key is `tenant:user` from the verified session, so it cannot be spoofed by
 * a header — and unlike the declarative `metadata.rateLimit` path it does not
 * collapse every caller into one shared bucket when no client IP can be trusted.
 *
 * `failClosed` is per-endpoint, not global. A write that slips through
 * uncounted is the thing the limiter exists to stop, so a degraded limiter
 * refuses it. A read has no such blast radius, and refusing it would turn a
 * Redis blip into "you cannot search for colleagues" — so reads fail open.
 */
export async function enforceChatRateLimit(
  request: ChatRequestContext,
  config: RateLimitConfig,
  options: { failClosed: boolean },
): Promise<Response | null> {
  const rateLimiterService = getCachedRateLimiterService()
  if (!rateLimiterService) {
    logger.error('Rate limiter service is not registered — check RATE_LIMIT_* configuration', {
      keyPrefix: config.keyPrefix,
      failClosed: options.failClosed,
    })
    // An absent limiter is the same condition as an unreachable one: the request
    // cannot be counted. Returning `null` here would have made a single bad
    // `RATE_LIMIT_STRATEGY` value silently disable every chat write limit while
    // the code above still claimed to fail closed.
    if (!options.failClosed) return null
    return NextResponse.json({ error: request.messages.rateLimitUnavailable }, { status: 503 })
  }
  return checkRateLimit(
    rateLimiterService,
    config,
    `${request.scope.tenantId}:${request.userId}`,
    request.messages.rateLimited,
    { failClosed: options.failClosed, unavailableMessage: request.messages.rateLimitUnavailable },
  )
}

export type ChatMutationOperation = 'create' | 'update' | 'delete'

/**
 * Execute a command through the bus with the mutation-guard contract wired in.
 * A write that skips this silently opts out of record locks and every future
 * global guard.
 */
export async function runChatCommand<TInput, TResult>(options: {
  request: ChatRequestContext
  req: Request
  commandId: string
  input: TInput
  resourceKind: string
  resourceId?: string | null
  operation: ChatMutationOperation
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
  return { ok: true, result }
}

/** Domain errors carry their own HTTP shape; zod failures are a 400; the rest is a logged 500. */
export async function toChatErrorResponse(error: unknown, route: string): Promise<Response> {
  const messages = await loadChatMessages()
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
