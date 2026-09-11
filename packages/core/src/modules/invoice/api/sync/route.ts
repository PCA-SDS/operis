import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveInvoiceInvoiceRouteContext, handleInvoiceInvoiceRouteError } from '../invoices/shared'
import { invoiceSyncStartSchema } from '../../data/validators'
import { createInvoiceOperationId } from '../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['invoice.sync'] }, POST: { requireAuth: true, requireFeatures: ['invoice.sync'] } } as const

export async function GET(req: Request) {
  try { const context = await resolveInvoiceInvoiceRouteContext(req); const service = context.container.resolve('invoiceSyncService') as { availability(scope: typeof context.scope): Promise<unknown> }; return NextResponse.json(await service.availability(context.scope)) }
  catch (error) { return handleInvoiceInvoiceRouteError(error, 'sync availability') }
}

export async function POST(req: Request) {
  try {
    const context = await resolveInvoiceInvoiceRouteContext(req)
    const body = await req.json().catch(() => ({}))
    const parsed = invoiceSyncStartSchema.parse(body)
    const guarded = await runRouteMutationGuards({ container: context.container, req, auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId }, input: { resourceKind: 'invoice.sync', operation: 'create', mutationPayload: parsed } })
    if (!guarded.ok) return guarded.response
    const service = context.container.resolve('invoiceSyncService') as { start(scope: typeof context.scope, userId: string, input: unknown): Promise<unknown> }
    const result = await service.start(context.scope, context.userId, parsed)
    await guarded.runAfterSuccess()
    return NextResponse.json(result, { status: result && typeof result === 'object' && 'state' in result && result.state === 'queued' ? 202 : 200 })
  } catch (error) { return handleInvoiceInvoiceRouteError(error, 'start invoice sync') }
}

export const openApi: OpenApiRouteDoc = { tag: 'Invoices', summary: 'GDT invoice synchronization', methods: { GET: { operationId: createInvoiceOperationId('sync', 'availability'), summary: 'Get sync availability', responses: [{ status: 200, description: 'Availability' }] }, POST: { operationId: createInvoiceOperationId('sync', 'start'), summary: 'Start sync', requestBody: { schema: invoiceSyncStartSchema }, responses: [{ status: 202, description: 'Queued' }] } } }
