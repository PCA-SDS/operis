import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  claimConditionGradeSchema,
  claimLineReceiveSchema,
  claimLineReleaseQuarantineSchema,
  type ClaimLineReceiveInput,
  type ClaimLineReleaseQuarantineInput,
} from '../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toRecord } from '@open-mercato/shared/lib/guards'
import { resolveActionContext, type ActionRouteContext, runClaimLineActionGuard } from '../actionContext'

const logger = createLogger('warranty_claims')

type ReceivingAction =
  | { kind: 'receive'; input: ClaimLineReceiveInput }
  | { kind: 'release'; input: ClaimLineReleaseQuarantineInput }

const uuid = z.string().uuid()
const optimisticLockTokenSchema = z.string().datetime().nullable().optional()

const receiveBodySchema = z
  .object({
    lineId: uuid,
    conditionGrade: claimConditionGradeSchema,
    inspectionNotes: z.string().trim().max(4000).optional(),
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()

const releaseBodySchema = z
  .object({
    lineId: uuid,
    action: z.literal('release'),
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()

const receivingBodySchema = z.union([releaseBodySchema, receiveBodySchema])

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.receiving.manage'] },
}

function toReceivingAction(payload: Record<string, unknown>, context: ActionRouteContext): ReceivingAction {
  const releaseBody = releaseBodySchema.safeParse(payload)
  if (releaseBody.success) {
    const scopedPayload = withScopedPayload({
      id: releaseBody.data.lineId,
      updatedAt: releaseBody.data.updatedAt,
    }, context.ctx, context.translate)
    return { kind: 'release', input: claimLineReleaseQuarantineSchema.parse(scopedPayload) }
  }
  const body = receiveBodySchema.parse(payload)
  const scopedPayload = withScopedPayload({
    id: body.lineId,
    conditionGrade: body.conditionGrade,
    inspectionNotes: body.inspectionNotes,
    updatedAt: body.updatedAt,
  }, context.ctx, context.translate)
  return { kind: 'receive', input: claimLineReceiveSchema.parse(scopedPayload) }
}

function toGuardedAction(kind: ReceivingAction['kind'], payload: Record<string, unknown>): ReceivingAction {
  if (kind === 'release') {
    return { kind, input: claimLineReleaseQuarantineSchema.parse(payload) }
  }
  return { kind, input: claimLineReceiveSchema.parse(payload) }
}

async function executeReceivingAction(
  commandBus: CommandBus,
  action: ReceivingAction,
  ctx: CommandRuntimeContext,
): Promise<{ lineId: string; claimId: string }> {
  if (action.kind === 'release') {
    const { result } = await commandBus.execute<ClaimLineReleaseQuarantineInput, { lineId: string; claimId: string }>(
      'warranty_claims.claim_line.release_quarantine',
      { input: action.input, ctx },
    )
    if (!result) throw new CrudHttpError(400, { error: 'warranty_claims.errors.save_failed' })
    return result
  }
  const { result } = await commandBus.execute<ClaimLineReceiveInput, { lineId: string; claimId: string }>(
    'warranty_claims.claim_line.receive',
    { input: action.input, ctx },
  )
  if (!result) throw new CrudHttpError(400, { error: 'warranty_claims.errors.save_failed' })
  return result
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const action = toReceivingAction(payload, context)
    const guarded = await runClaimLineActionGuard(req, context, action.input.id, { ...action.input })
    if (!guarded.ok) {
      return guarded.response
    }
    const commandAction = guarded.modifiedPayload ? toGuardedAction(action.kind, guarded.modifiedPayload) : action

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const result = await executeReceivingAction(commandBus, commandAction, context.ctx)

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, lineId: result.lineId, claimId: result.claimId })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'warranty_claims.errors.invalidInput' }, { status: 400 })
    }
    logger.error('warranty_claims.receiving.post failed', { err })
    return NextResponse.json({ error: 'warranty_claims.errors.save_failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Receive or release a warranty claim line',
  methods: {
    POST: {
      summary: 'Grade a received line or release its quarantine hold',
      requestBody: { contentType: 'application/json', schema: receivingBodySchema },
      responses: [
        {
          status: 200,
          description: 'Receiving action applied',
          schema: z.object({
            ok: z.boolean(),
            lineId: z.string().uuid(),
            claimId: z.string().uuid(),
          }),
        },
      ],
    },
  },
}
