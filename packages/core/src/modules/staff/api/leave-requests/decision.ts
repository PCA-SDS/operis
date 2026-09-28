import { NextResponse } from 'next/server'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { staffLeaveRequestDecisionSchema, type StaffLeaveRequestDecisionInput } from '../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { buildStaffRouteContext } from '../routeContext'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const logger = createLogger('staff')

export type LeaveRequestDecision = {
  commandId: 'staff.leave-requests.accept' | 'staff.leave-requests.reject'
  errorKey: string
  errorFallback: string
}

export async function decideLeaveRequest(req: Request, decision: LeaveRequestDecision): Promise<NextResponse> {
  try {
    const { ctx, translate } = await buildStaffRouteContext(req)
    const body = await readJsonSafe(req, {})
    const input = parseScopedCommandInput(staffLeaveRequestDecisionSchema, body, ctx, translate)

    const auth = ctx.auth
    const tenantId = auth?.tenantId ?? ''
    const organizationId = ctx.selectedOrganizationId ?? null
    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId: auth?.sub ?? '', tenantId, organizationId },
      input: {
        resourceKind: 'staff.leave_request',
        resourceId: input.id,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody,
        { status: guardResult.errorStatus },
      )
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<StaffLeaveRequestDecisionInput, { requestId: string }>(
      decision.commandId,
      { input, ctx },
    )

    await guardResult.runAfterSuccess({ resourceId: result?.requestId ?? input.id })

    const response = NextResponse.json({ ok: true, id: result?.requestId ?? null }, { status: 200 })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'staff.leave_request',
      resourceId: result?.requestId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error(`${decision.commandId} failed`, { err })
    return NextResponse.json({ error: translate(decision.errorKey, decision.errorFallback) }, { status: 400 })
  }
}
