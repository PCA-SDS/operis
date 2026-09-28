import { NextResponse } from 'next/server'
import { z } from 'zod'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  staffTeamMemberTagAssignmentSchema,
  type StaffTeamMemberTagAssignmentInput,
} from '../../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { buildStaffRouteContext } from '../../../routeContext'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const logger = createLogger('staff')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
}

export async function POST(req: Request) {
  try {
    const { ctx, translate } = await buildStaffRouteContext(req)
    const body = await readJsonSafe(req, {})
    const input = parseScopedCommandInput(staffTeamMemberTagAssignmentSchema, body, ctx, translate)

    const auth = ctx.auth
    const tenantId = auth?.tenantId ?? ''
    const organizationId = ctx.selectedOrganizationId ?? null
    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId: auth?.sub ?? '', tenantId, organizationId },
      input: {
        resourceKind: 'staff.team_member',
        resourceId: input.memberId,
        operation: 'delete',
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
    const { result, logEntry } = await commandBus.execute<StaffTeamMemberTagAssignmentInput, { memberId: string }>(
      'staff.team-members.tags.unassign',
      { input, ctx },
    )

    await guardResult.runAfterSuccess({ resourceId: result?.memberId ?? input.memberId })

    const response = NextResponse.json({ id: result?.memberId ?? null })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'staff.teamMemberTagAssignment',
      resourceId: result?.memberId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('staff.teamMembers.tags.unassign failed', { err })
    return NextResponse.json({ error: translate('staff.teamMembers.tags.updateError', 'Failed to update tags.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Unassign team member tag',
  methods: {
    POST: {
      summary: 'Unassign team member tag',
      description: 'Removes a tag from a staff team member.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTeamMemberTagAssignmentSchema,
      },
      responses: [
        { status: 200, description: 'Tag assignment removed', schema: z.object({ id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
