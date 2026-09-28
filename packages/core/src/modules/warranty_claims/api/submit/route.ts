import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toRecord } from '@open-mercato/shared/lib/guards'
import { resolveActionContext, runClaimActionGuard } from '../actionContext'

const logger = createLogger('warranty_claims')

// Scope is derived from the authenticated principal, never accepted from the body —
// mirroring the sibling transition/assign routes. `withScopedPayload` prefers a
// caller-supplied tenantId/organizationId over the actor's context, so admitting them
// here would let the request choose its own scope.
const submitSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict()

type SubmitInput = z.infer<typeof submitSchema>

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const scopedPayload = toRecord(withScopedPayload(payload, context.ctx, context.translate))
    const input = submitSchema.parse({ id: scopedPayload.id })
    const guarded = await runClaimActionGuard(req, context, input.id, { ...input })
    if (!guarded.ok) {
      return guarded.response
    }
    const commandInput = guarded.modifiedPayload ? submitSchema.parse(guarded.modifiedPayload) : input

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<SubmitInput, { claimId: string }>(
      'warranty_claims.claim.submit',
      { input: commandInput, ctx: context.ctx },
    )

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, claimId: result?.claimId ?? commandInput.id })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.submit.post failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Submit warranty claim',
  methods: {
    POST: {
      summary: 'Submit a draft claim',
      requestBody: { contentType: 'application/json', schema: submitSchema },
      responses: [
        {
          status: 200,
          description: 'Claim submitted',
          schema: z.object({ ok: z.boolean(), claimId: z.string().uuid() }),
        },
      ],
    },
  },
}
