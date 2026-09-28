import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { claimCreateSalesReturnSchema, type ClaimCreateSalesReturnInput } from '../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toRecord } from '@open-mercato/shared/lib/guards'
import { resolveActionContext, type ActionRouteContext, runClaimActionGuard } from '../actionContext'

const logger = createLogger('warranty_claims')

type SalesReturnCommandResult = {
  claimId: string
  salesReturnId: string
  salesReturnUpdatedAt: string | null
  skippedLineIds: string[]
}

const uuid = z.string().uuid()
const optimisticLockTokenSchema = z.string().datetime().nullable().optional()

const salesReturnRequestSchema = z
  .object({
    claimId: uuid,
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()

type SalesReturnRequest = z.infer<typeof salesReturnRequestSchema>

const salesReturnResponseSchema = z.object({
  salesReturnId: z.string(),
  skippedLineIds: z.array(z.string()),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage', 'sales.returns.create'] },
}

function toSalesReturnRequest(payload: Record<string, unknown>): SalesReturnRequest {
  return salesReturnRequestSchema.parse({
    claimId: payload.claimId ?? payload.id,
    updatedAt: payload.updatedAt,
  })
}

function toCommandInput(input: SalesReturnRequest, context: ActionRouteContext): ClaimCreateSalesReturnInput {
  const scopedPayload = withScopedPayload({
    id: input.claimId,
    updatedAt: input.updatedAt,
  }, context.ctx, context.translate)
  return claimCreateSalesReturnSchema.parse(scopedPayload)
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const requestInput = toSalesReturnRequest(toRecord(await readJsonSafe(req, {})))
    const guarded = await runClaimActionGuard(req, context, requestInput.claimId, { ...requestInput })
    if (!guarded.ok) {
      return guarded.response
    }
    const guardedInput = guarded.modifiedPayload ? toSalesReturnRequest(guarded.modifiedPayload) : requestInput
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<ClaimCreateSalesReturnInput, SalesReturnCommandResult>(
      'warranty_claims.claim.create_sales_return',
      { input: toCommandInput(guardedInput, context), ctx: context.ctx },
    )
    if (!result) throw new CrudHttpError(400, { error: 'warranty_claims.errors.save_failed' })
    await guarded.runAfterSuccess()
    return NextResponse.json({ salesReturnId: result.salesReturnId, skippedLineIds: result.skippedLineIds })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'warranty_claims.errors.invalidInput' }, { status: 400 })
    }
    logger.error('warranty_claims.sales-return.post failed', { err })
    return NextResponse.json({ error: 'warranty_claims.errors.save_failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Create a sales return from an approved warranty claim',
  methods: {
    POST: {
      summary: 'Create a sales return document from the claim\'s eligible lines and link it to the claim',
      requestBody: {
        contentType: 'application/json',
        schema: salesReturnRequestSchema,
        description: 'Use claimId to identify the warranty claim. The id field is also accepted as an alias for claimId.',
      },
      responses: [
        {
          status: 200,
          description: 'Sales return created and linked; lines without an order-line reference are reported as skipped',
          schema: salesReturnResponseSchema,
        },
        { status: 400, description: 'Invalid request or claim is not eligible for sales-return creation', schema: errorResponseSchema },
        { status: 401, description: 'Authentication required', schema: errorResponseSchema },
        { status: 403, description: 'Insufficient permissions', schema: errorResponseSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: errorResponseSchema },
      ],
    },
  },
}
