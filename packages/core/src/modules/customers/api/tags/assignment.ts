import { NextResponse } from 'next/server'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { tagAssignmentSchema, type TagAssignmentInput } from '../../data/validators'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { buildTagRouteContext } from './context'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const logger = createLogger('customers')

const TAG_ASSIGNMENT_RESOURCE_KIND = 'customers.tagAssignment'

export type CustomerTagChange = {
  commandId: 'customers.tags.assign' | 'customers.tags.unassign'
  successStatus: 200 | 201
  errorKey: string
  errorFallback: string
}

export async function changeCustomerTag(req: Request, change: CustomerTagChange): Promise<NextResponse> {
  try {
    const { ctx, auth, translate } = await buildTagRouteContext(req)
    const tenantId = auth!.tenantId
    const organizationId = ctx.selectedOrganizationId
    if (!tenantId || !organizationId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const body = await readJsonSafe(req, {})
    const scoped = withScopedPayload(body, ctx, translate)
    const input = tagAssignmentSchema.parse(scoped)

    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId: auth!.sub, tenantId, organizationId },
      input: {
        resourceKind: TAG_ASSIGNMENT_RESOURCE_KIND,
        resourceId: input.entityId,
        operation: 'custom',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<TagAssignmentInput, { assignmentId: string | null }>(
      change.commandId,
      { input, ctx },
    )
    await guardResult.runAfterSuccess()
    const response = NextResponse.json({ id: result?.assignmentId ?? null }, { status: change.successStatus })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'customers.tagAssignment',
      resourceId: result?.assignmentId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error(`${change.commandId} failed`, { err })
    return NextResponse.json({ error: translate(change.errorKey, change.errorFallback) }, { status: 400 })
  }
}
