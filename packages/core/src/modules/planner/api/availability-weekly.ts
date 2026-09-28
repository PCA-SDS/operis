import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { plannerAvailabilityWeeklyReplaceSchema } from '../data/validators'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { assertAvailabilityWriteAccess, resolveAvailabilityActorId, resolveAvailabilityRequestContext } from './access'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'

const logger = createLogger('planner').child({ component: 'availability' })

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveAvailabilityRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await readJsonSafe(req, {})
    const input = parseScopedCommandInput(plannerAvailabilityWeeklyReplaceSchema, payload, ctx, translate)
    await assertAvailabilityWriteAccess(ctx, { subjectType: input.subjectType, subjectId: input.subjectId }, translate)
    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: {
        userId: resolveAvailabilityActorId(ctx.auth),
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      input: { resourceKind: 'planner.availability', resourceId: input.subjectId, operation: 'custom', mutationPayload: input },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute('planner.availability.weekly.replace', { input, ctx })
    await invalidateCrudCache(
      ctx.container,
      'planner.availability.rule',
      {
        id: null,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      },
      input.tenantId,
      'weekly_replace',
    )
    await guardResult.runAfterSuccess()
    const response = NextResponse.json({ ok: true })
    attachOperationMetadataHeader(response, logEntry, { resourceKind: 'planner.availability' })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('Weekly availability replace failed', { err })
    return NextResponse.json(
      { error: translate('planner.availability.errors.updateWeekly', 'Failed to save weekly availability.') },
      { status: 400 },
    )
  }
}

export const openApi = {
  tag: 'Planner',
  summary: 'Replace weekly availability',
  methods: {
    POST: {
      summary: 'Replace weekly availability',
      description: 'Replaces weekly availability rules for the subject in a single request.',
      requestBody: {
        contentType: 'application/json',
        schema: plannerAvailabilityWeeklyReplaceSchema,
      },
      responses: [
        { status: 200, description: 'Weekly availability updated', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'Optimistic lock conflict',
          schema: z.object({
            error: z.string(),
            code: z.literal('optimistic_lock_conflict'),
            currentUpdatedAt: z.string(),
            expectedUpdatedAt: z.string(),
          }),
        },
      ],
    },
  },
}
