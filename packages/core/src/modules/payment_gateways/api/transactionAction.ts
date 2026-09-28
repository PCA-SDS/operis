import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { PaymentGatewayService } from '../lib/gateway-service'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const gatewayTransactionResourceKind = 'payment_gateways.gateway_transaction'

type GatewayTransactionScope = { organizationId: string; tenantId: string }

export type GatewayTransactionAction<TData extends { transactionId: string }> = {
  schema: z.ZodType<TData>
  perform: (service: PaymentGatewayService, data: TData, scope: GatewayTransactionScope) => Promise<unknown>
  failureMessage: string
}

export async function runGatewayTransactionAction<TData extends { transactionId: string }>(
  req: Request,
  action: GatewayTransactionAction<TData>,
): Promise<NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = action.schema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub ?? '', tenantId: auth.tenantId, organizationId: auth.orgId },
    input: {
      resourceKind: gatewayTransactionResourceKind,
      resourceId: parsed.data.transactionId,
      operation: 'update',
      mutationPayload: parsed.data as Record<string, unknown>,
    },
  })
  if (!guardResult.ok) {
    return NextResponse.json(
      guardResult.errorBody,
      { status: guardResult.errorStatus },
    )
  }

  const service = container.resolve('paymentGatewayService') as PaymentGatewayService

  try {
    const result = await action.perform(service, parsed.data, { organizationId: auth.orgId as string, tenantId: auth.tenantId })
    await guardResult.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : action.failureMessage
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
