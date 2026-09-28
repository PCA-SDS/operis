import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveAuthActorId } from '@open-mercato/shared/lib/auth/actor'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const logger = createLogger('customers')

export type InteractionLifecycleCommand<TInput extends { id: string }> = {
  commandId: 'customers.interactions.cancel' | 'customers.interactions.complete'
  schema: z.ZodType<TInput>
}

export async function runInteractionLifecycleCommand<TInput extends { id: string }>(
  req: Request,
  command: InteractionLifecycleCommand<TInput>,
): Promise<NextResponse> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = command.schema.parse(body)
    const guardUserId = resolveAuthActorId(auth)
    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: guardUserId, tenantId: auth.tenantId, organizationId: ctx.selectedOrganizationId },
      input: {
        resourceKind: 'customers.interaction',
        resourceId: parsed.id,
        operation: 'custom',
        mutationPayload: parsed,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute<TInput, { interactionId: string }>(
      command.commandId,
      { input: parsed, ctx },
    )
    await guardResult.runAfterSuccess()
    return attachOperationMetadataHeader(
      NextResponse.json({ ok: true }),
      logEntry,
      { resourceKind: 'customers.interaction', resourceId: parsed.id },
    )
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    logger.error(`${command.commandId} failed`, { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
