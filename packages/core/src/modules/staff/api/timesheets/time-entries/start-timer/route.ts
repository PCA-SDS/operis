import { NextResponse } from 'next/server'
import { z } from 'zod'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { staffTimeEntryStartTimerSchema, type StaffTimeEntryStartTimerInput } from '../../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { buildStaffRouteContext } from '../../../routeContext'

const logger = createLogger('staff')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export async function POST(req: Request) {
  try {
    const { ctx, translate } = await buildStaffRouteContext(req)
    const body = await readJsonSafe(req, {})
    const input = parseScopedCommandInput(staffTimeEntryStartTimerSchema, body, ctx, translate)
    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<StaffTimeEntryStartTimerInput, { timeEntryId: string }>(
      'staff.timesheets.time_entries.start_timer',
      { input, ctx },
    )
    const response = NextResponse.json({ ok: true, id: result?.timeEntryId ?? null }, { status: 201 })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: result?.timeEntryId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('staff.timesheets.time-entries.start-timer failed', { err })
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.timerStart', 'Failed to start timer.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Start a timesheet timer',
  methods: {
    POST: {
      summary: 'Start a timesheet timer',
      description:
        'Atomically creates a timer-sourced time entry and starts it (sets startedAt and creates the initial work segment) in a single transaction, so a partial failure cannot leave an orphaned, unstarted entry.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeEntryStartTimerSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Timer started',
          schema: z.object({ ok: z.literal(true), id: z.string().uuid().nullable() }),
        },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'Another timer is already running for this staff member',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 422,
          description: 'Referenced time project not found or out of scope',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
