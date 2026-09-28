import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { vendorRecoveryInputSchema, type VendorRecoveryInput } from '../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toRecord } from '@open-mercato/shared/lib/guards'
import { resolveActionContext, runClaimActionGuard } from '../actionContext'

const logger = createLogger('warranty_claims')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

function toVendorRecoveryInput(scopedPayload: Record<string, unknown>): VendorRecoveryInput {
  return vendorRecoveryInputSchema.parse({
    claimId: scopedPayload.claimId,
    lineIds: scopedPayload.lineIds,
    vendorName: scopedPayload.vendorName,
    vendorRef: scopedPayload.vendorRef,
  })
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const scopedPayload = withScopedPayload(payload, context.ctx, context.translate)
    const input = toVendorRecoveryInput(scopedPayload)
    const guarded = await runClaimActionGuard(req, context, input.claimId, { ...input })
    if (!guarded.ok) {
      return guarded.response
    }
    const commandInput = guarded.modifiedPayload ? toVendorRecoveryInput(guarded.modifiedPayload) : input

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<VendorRecoveryInput, { claimId: string }>(
      'warranty_claims.claim.create_vendor_recovery',
      { input: commandInput, ctx: context.ctx },
    )
    const createdClaimId = result?.claimId
    if (typeof createdClaimId !== 'string') {
      throw new CrudHttpError(400, { error: context.translate('warranty_claims.errors.notFound', 'Warranty claim not found.') })
    }

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, claimId: createdClaimId })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.vendor-recovery.post failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Create vendor recovery claim',
  methods: {
    POST: {
      summary: 'Create a linked vendor-recovery claim from resolved source lines',
      requestBody: { contentType: 'application/json', schema: vendorRecoveryInputSchema },
      responses: [
        {
          status: 200,
          description: 'Vendor recovery claim created',
          schema: z.object({ ok: z.boolean(), claimId: z.string().uuid() }),
        },
      ],
    },
  },
}
