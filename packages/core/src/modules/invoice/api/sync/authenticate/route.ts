import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveInvoiceInvoiceRouteContext, handleInvoiceInvoiceRouteError } from '../../invoices/shared'
import { createInvoiceOperationId } from '../../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['invoice.sync'] } } as const
export async function POST(req: Request) {
  try { const context = await resolveInvoiceInvoiceRouteContext(req); const service = context.container.resolve('invoiceSyncService') as { authenticate(scope: typeof context.scope, userId: string, input: unknown): Promise<unknown> }; const result = await service.authenticate(context.scope, context.userId, await req.json().catch(() => ({}))); return NextResponse.json(result, { status: 202 }) }
  catch (error) { return handleInvoiceInvoiceRouteError(error, 'authenticate invoice sync') }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Invoices',
  summary: 'Authenticate GDT invoice synchronization',
  methods: {
    POST: {
      operationId: createInvoiceOperationId('sync', 'authenticate'),
      summary: 'Authenticate invoice sync',
      responses: [{ status: 202, description: 'Sync queued' }],
    },
  },
}
