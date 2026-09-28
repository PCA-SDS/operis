import { NextResponse } from 'next/server'
import { z } from 'zod'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '../../utils'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveGrantedFeatures } from '@open-mercato/shared/lib/auth/grantedFeatures'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveRequestContext } from '../requestContext'

const logger = createLogger('sales')

const convertSchema = z.object({
  quoteId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().trim().max(191).optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.quotes.manage', 'sales.orders.manage'] },
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await readJsonSafe(req, {})
    const scoped = withScopedPayload(payload ?? {}, ctx, translate)
    const input = convertSchema.parse(scoped)
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: {
        userId: ctx.auth?.sub ?? '',
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId,
        userFeatures: await resolveGrantedFeatures(ctx.container, ctx.auth, organizationId),
      },
      input: { resourceKind: 'sales.quote', resourceId: input.quoteId, operation: 'update' },
    })
    if (!guardResult.ok) return guardResult.response
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      { quoteId: string; orderId?: string; orderNumber?: string },
      { orderId: string }
    >('sales.quotes.convert_to_order', { input, ctx })

    const orderId = result?.orderId ?? input.orderId ?? input.quoteId
    const jsonResponse = NextResponse.json({ orderId })

    attachOperationMetadataHeader(jsonResponse, logEntry, {
      resourceKind: 'sales.order',
      resourceId: orderId,
    })

    await guardResult.runAfterSuccess()

    return jsonResponse
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.quotes.convert failed', { err })
    return NextResponse.json(
      { error: translate('sales.documents.detail.convertError', 'Failed to convert quote.') },
      { status: 400 }
    )
  }
}

const convertResponseSchema = z.object({
  orderId: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Convert quote to order',
  methods: {
    POST: {
      summary: 'Convert quote',
      description: 'Creates a sales order from a quote and removes the original quote record.',
      requestBody: {
        contentType: 'application/json',
        schema: convertSchema,
      },
      responses: [
        { status: 200, description: 'Conversion succeeded', schema: convertResponseSchema },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Conflict detected', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 423, description: 'Record locked', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
