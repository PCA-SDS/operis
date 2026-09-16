import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveInvoiceInvoiceRouteContext, handleInvoiceInvoiceRouteError, readRequestRecord } from '../../invoices/shared'
import { createInvoiceOperationId } from '../../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['invoice.sync'] } } as const
export async function POST(req: Request) {
  try {
    const context = await resolveInvoiceInvoiceRouteContext(req)
    const body = await readRequestRecord(req)
    // This path consumes a CAPTCHA attempt, sets the auth-backoff key, caches a GDT bearer
    // token and enqueues a sync job — the same class of write as `POST /sync`, which guards.
    const guarded = await runRouteMutationGuards({ container: context.container, req, auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId }, input: { resourceKind: 'invoice.sync', operation: 'create', mutationPayload: body } })
    if (!guarded.ok) return guarded.response
    const service = context.container.resolve('invoiceSyncService') as { authenticate(scope: typeof context.scope, userId: string, input: unknown): Promise<unknown> }
    const result = await service.authenticate(context.scope, context.userId, body)
    await guarded.runAfterSuccess()
    const status = result && typeof result === 'object' && 'state' in result && result.state === 'queued' ? 202 : 200
    return NextResponse.json(result, { status })
  }
  catch (error) { return handleInvoiceInvoiceRouteError(error, 'authenticate invoice sync') }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Invoices',
  summary: 'Authenticate GDT invoice synchronization',
  methods: {
    POST: {
      operationId: createInvoiceOperationId('sync', 'authenticate'),
      summary: 'Authenticate invoice sync',
      responses: [{ status: 200, description: 'Authentication result' }, { status: 202, description: 'Sync queued' }],
    },
  },
}
