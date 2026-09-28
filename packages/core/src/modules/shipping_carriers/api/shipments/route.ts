import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ShippingCarrierService } from '../../lib/shipping-service'
import { isShipmentIdempotencyConflictError } from '../../lib/shipment-idempotency'
import { shippingCarrierUpstreamErrorResponse } from '../../lib/upstream-error-response'
import { createShipmentSchema } from '../../data/validators'
import { shippingCarriersTag } from '../openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

function resolveGuardUserId(auth: {
  sub?: string | null
  userId?: string | null
  keyId?: string | null
}): string {
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

export const metadata = {
  path: '/shipping-carriers/shipments',
  POST: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const payload = await readJsonSafe<unknown>(req)
  const parsed = createShipmentSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }
  const container = await createRequestContainer()
  const guardUserId = resolveGuardUserId(auth)
  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: guardUserId, tenantId: auth.tenantId, organizationId: auth.orgId },
    input: {
      resourceKind: 'shipping_carriers.shipment',
      resourceId: parsed.data.orderId,
      operation: 'create',
      mutationPayload: parsed.data as Record<string, unknown>,
    },
  })
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
  }

  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  try {
    const shipment = await service.createShipment({
      ...parsed.data,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })

    await guardResult.runAfterSuccess()

    return NextResponse.json({
      shipmentId: shipment.id,
      carrierShipmentId: shipment.carrierShipmentId,
      trackingNumber: shipment.trackingNumber,
      status: shipment.unifiedStatus,
      labelUrl: shipment.labelUrl,
    }, { status: 201 })
  } catch (error: unknown) {
    if (isShipmentIdempotencyConflictError(error)) {
      return NextResponse.json(
        { error: 'Shipment idempotency conflict', code: 'idempotency_conflict' },
        { status: 409 },
      )
    }
    return shippingCarrierUpstreamErrorResponse('shipments.create', error)
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Create shipment',
  methods: {
    POST: {
      summary: 'Create shipment',
      tags: [shippingCarriersTag],
      responses: [
        { status: 201, description: 'Shipment created' },
        { status: 409, description: 'Idempotency conflict: the idempotency key was reused with a different payload' },
        { status: 422, description: 'Validation failed' },
        { status: 502, description: 'Provider upstream error' },
      ],
    },
  },
}
