import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveInvoiceInvoiceRouteContext, handleInvoiceInvoiceRouteError } from '../../invoices/shared'
import { createInvoiceOperationId } from '../../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['invoice.sync'] } } as const
export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try { const context = await resolveInvoiceInvoiceRouteContext(req); const service = context.container.resolve('invoiceSyncService') as { getStatus(scope: typeof context.scope, jobId: string): Promise<unknown> }; const result = await service.getStatus(context.scope, (await params).jobId); return result ? NextResponse.json(result) : NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  catch (error) { return handleInvoiceInvoiceRouteError(error, 'read invoice sync status') }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Invoices',
  summary: 'Read GDT invoice sync status',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('sync', 'status'),
      summary: 'Read sync status',
      responses: [{ status: 200, description: 'Sync status' }],
    },
  },
}
