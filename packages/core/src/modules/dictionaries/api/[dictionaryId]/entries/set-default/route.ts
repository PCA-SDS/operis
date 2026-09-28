import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import {
  setDefaultDictionaryEntryCommandSchema,
  setDefaultDictionaryEntrySchema,
  type SetDefaultDictionaryEntryCommandInput,
} from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  dictionaryIdParamsSchema,
  dictionariesErrorSchema,
  dictionariesOkSchema,
  dictionariesTag,
  setDefaultEntryRequestSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveAuthActorId } from '@open-mercato/shared/lib/auth/actor'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const logger = createLogger('dictionaries').child({ component: 'entries-api' })

const paramsSchema = z.object({ dictionaryId: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function POST(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    if (!context.auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })

    if (!context.organizationId) {
      throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.organization_required', 'Organization context is required') })
    }
    const dictionaryEm = context.em.fork()
    const dictionary = await findOneWithDecryption(
      dictionaryEm,
      Dictionary,
      {
        id: dictionaryId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      undefined,
      { tenantId: context.tenantId, organizationId: context.organizationId },
    )
    if (!dictionary) {
      throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
    }

    const payload = setDefaultDictionaryEntrySchema.parse(await readJsonSafe(req, {}))
    const guardUserId = resolveAuthActorId(context.auth)
    const guardResult = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: guardUserId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: 'dictionaries.dictionary',
        resourceId: dictionaryId,
        operation: 'custom',
        mutationPayload: payload,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandInput = setDefaultDictionaryEntryCommandSchema.parse({
      dictionaryId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      entryId: payload.entryId,
    } satisfies SetDefaultDictionaryEntryCommandInput)

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute<SetDefaultDictionaryEntryCommandInput, { dictionaryId: string; entryId: string; clearedIds: string[] }>(
      'dictionaries.entries.set_default',
      {
        input: commandInput,
        ctx: context.ctx,
      },
    )

    await guardResult.runAfterSuccess()

    const response = NextResponse.json({ ok: true })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'dictionaries.dictionary',
      resourceId: dictionaryId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to set default entry', { err })
    return NextResponse.json({ error: 'Failed to set default entry' }, { status: 500 })
  }
}

const setDefaultPostDoc: OpenApiMethodDoc = {
  summary: 'Set default dictionary entry',
  description: 'Marks the specified entry as the default for this dictionary, clearing any previous default.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: setDefaultEntryRequestSchema,
    description: 'ID of the entry to set as default.',
  },
  responses: [
    { status: 200, description: 'Default entry set.', schema: dictionariesOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary or entry not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to set default entry', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Set default dictionary entry',
  pathParams: dictionaryIdParamsSchema,
  methods: {
    POST: setDefaultPostDoc,
  },
}
