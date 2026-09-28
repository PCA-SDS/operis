import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { plannerAvailabilityDateSpecificReplaceSchema } from '../data/validators'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { PlannerAvailabilityRule } from '../data/entities'
import { parseAvailabilityRuleWindow } from '../lib/availabilitySchedule'
import { assertAvailabilityWriteAccess, resolveAvailabilityActorId, resolveAvailabilityRequestContext } from './access'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { toLocalDateKey } from '@open-mercato/shared/lib/date/format'

const logger = createLogger('planner').child({ component: 'availability' })

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveAvailabilityRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await readJsonSafe(req, {})
    const normalized = normalizeDateSpecificPayload(payload)
    const input = parseScopedCommandInput(plannerAvailabilityDateSpecificReplaceSchema, normalized, ctx, translate)
    const isUnavailability = input.kind === 'unavailability' || input.isAvailable === false
    const access = await assertAvailabilityWriteAccess(
      ctx,
      { subjectType: input.subjectType, subjectId: input.subjectId, requiresUnavailability: isUnavailability },
      translate,
    )
    if (!access.canManageAll && !access.canManageUnavailability) {
      const dateSet = resolveDateSet(input)
      if (dateSet.size) {
        const em = ctx.container.resolve('em') as EntityManager
        const rules = await findWithDecryption(
          em,
          PlannerAvailabilityRule,
          {
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            kind: 'unavailability',
            deletedAt: null,
          },
          undefined,
          { tenantId: input.tenantId, organizationId: input.organizationId },
        )
        const blocked = rules.some((rule) => {
          const window = parseAvailabilityRuleWindow(rule)
          if (window.repeat !== 'once') return false
          return dateSet.has(toLocalDateKey(window.startAt))
        })
        if (blocked) {
          throw new CrudHttpError(403, { error: translate('planner.availability.errors.unauthorized', 'Unauthorized') })
        }
      }
    }
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
    const { logEntry } = await commandBus.execute('planner.availability.date-specific.replace', { input, ctx })
    await guardResult.runAfterSuccess()
    const response = NextResponse.json({ ok: true })
    attachOperationMetadataHeader(response, logEntry, { resourceKind: 'planner.availability' })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('Date-specific availability replace failed', { err })
    return NextResponse.json(
      { error: translate('planner.availability.errors.updateDateSpecific', 'Failed to save date-specific availability.') },
      { status: 400 },
    )
  }
}

export const openApi = {
  tag: 'Planner',
  summary: 'Replace date-specific availability',
  methods: {
    POST: {
      summary: 'Replace date-specific availability',
      description: 'Replaces date-specific availability rules for the subject in a single request.',
      requestBody: {
        contentType: 'application/json',
        schema: plannerAvailabilityDateSpecificReplaceSchema,
      },
      responses: [
        { status: 200, description: 'Date-specific availability updated', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'Conflict — the subject/date availability was modified by another edit',
          schema: z.object({
            error: z.string(),
            code: z.string(),
            currentUpdatedAt: z.string(),
            expectedUpdatedAt: z.string(),
          }),
        },
      ],
    },
  },
}

type DateSpecificPayload = {
  date?: string
  dates?: string[]
  kind?: string
  isAvailable?: boolean
  [key: string]: unknown
}

function normalizeDateSpecificPayload(payload: unknown): DateSpecificPayload {
  if (!payload || typeof payload !== 'object') return {}
  const data = { ...(payload as Record<string, unknown>) } as DateSpecificPayload
  if (!data.date && Array.isArray(data.dates) && data.dates.length > 0) {
    const first = data.dates.find((value) => typeof value === 'string' && value.length > 0)
    if (first) data.date = first
  }
  if (data.isAvailable === undefined && typeof data.kind === 'string') {
    data.isAvailable = data.kind !== 'unavailability'
  }
  return data
}

function resolveDateSet(input: { date?: string; dates?: string[] }): Set<string> {
  const dates = new Set<string>()
  if (typeof input.date === 'string' && input.date.length > 0) {
    dates.add(input.date)
  }
  if (Array.isArray(input.dates)) {
    input.dates.forEach((value) => {
      if (typeof value === 'string' && value.length > 0) {
        dates.add(value)
      }
    })
  }
  return dates
}
