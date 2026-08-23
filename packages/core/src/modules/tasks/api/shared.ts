// The plumbing every tasks route repeats: resolve the caller, pin the request
// to one tenant + organization, build a command context, run the mutation guard
// and turn thrown domain errors into the right HTTP status.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { TasksScope } from '../lib/people'

const logger = createLogger('tasks')

export type TasksRequestContext = {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  em: EntityManager
  scope: TasksScope
  userId: string
  ctx: CommandRuntimeContext
}

/**
 * Resolve the request into a scoped context, or return the response that should
 * be sent instead. Fails closed: no tenant → 401, no resolvable organization →
 * 400 (never 401, which `apiFetch` would read as an expired session and loop on).
 */
export async function resolveTasksRequest(
  req: Request,
): Promise<{ ok: true; value: TasksRequestContext } | { ok: false; response: Response }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.sub) {
    const { t } = await resolveTranslations()
    return {
      ok: false,
      response: NextResponse.json({ error: t('tasks.errors.unauthorized', 'Unauthorized') }, { status: 401 }),
    }
  }

  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { ok: false, response: organizationScopeRequiredResponse() }

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope,
    selectedOrganizationId: organizationId,
    organizationIds: organizationScope?.filterIds ?? [organizationId],
    request: req,
  }

  return {
    ok: true,
    value: {
      container,
      auth,
      em: container.resolve('em') as EntityManager,
      scope: { tenantId: auth.tenantId, organizationId },
      userId: auth.sub,
      ctx,
    },
  }
}

export function resolveService<T>(request: TasksRequestContext, name: string): T {
  return request.container.resolve(name) as T
}

type FeatureChecker = {
  userHasAllFeatures(
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

/**
 * Server-side feature check for the cases route metadata cannot express — for
 * example "edit any comment, or only your own". Route `requireFeatures` stays
 * the coarse gate; this is the fine one.
 */
export async function callerHasFeature(
  request: TasksRequestContext,
  feature: string,
): Promise<boolean> {
  const rbac = request.container.resolve('rbacService') as FeatureChecker
  return rbac.userHasAllFeatures(request.userId, [feature], {
    tenantId: request.scope.tenantId,
    organizationId: request.scope.organizationId,
  })
}

/** Domain errors already carry their HTTP shape; zod failures become a 400 with
 *  the issue list; anything else is logged and answered as a 500. */
export async function toErrorResponse(error: unknown, route: string): Promise<Response> {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  if (error instanceof z.ZodError) {
    const { t } = await resolveTranslations()
    return NextResponse.json(
      { error: t('tasks.errors.validationFailed', 'Validation failed'), details: error.issues },
      { status: 400 },
    )
  }
  logger.error(`${route} failed`, { err: error })
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('tasks.errors.internal', 'Internal server error') }, { status: 500 })
}

export type MutationOperation = 'create' | 'update' | 'delete' | 'custom'

export type RunCommandOptions<TInput> = {
  request: TasksRequestContext
  req: Request
  commandId: string
  input: TInput
  resourceKind: string
  resourceId?: string | null
  operation: MutationOperation
}

/**
 * Execute a command through the bus with the mutation-guard contract wired in —
 * record locks, optimistic-lock conflicts and any future global guard all hang
 * off this, so a write that skips it silently opts out of them.
 */
export async function runGuardedCommand<TInput, TResult>(
  options: RunCommandOptions<TInput>,
): Promise<{ ok: true; result: TResult } | { ok: false; response: Response }> {
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

  // A guard may rewrite the payload (record locks strip their header fields, for
  // example), so the command sees the merged version, not the raw request body.
  const effectiveInput = (guard.modifiedPayload ? { ...input, ...guard.modifiedPayload } : input) as TInput

  const commandBus = request.container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute<TInput, TResult>(commandId, {
    input: effectiveInput,
    ctx: request.ctx,
  })

  await guard.runAfterSuccess()

  return { ok: true, result }
}

export function jsonOk<T>(body: T): Response {
  return NextResponse.json(body)
}

/** Query params as a plain record, so a zod schema can coerce them. */
export function searchParamsToObject(url: string): Record<string, string> {
  const params = new URL(url).searchParams
  const result: Record<string, string> = {}
  for (const [key, value] of params.entries()) result[key] = value
  return result
}
