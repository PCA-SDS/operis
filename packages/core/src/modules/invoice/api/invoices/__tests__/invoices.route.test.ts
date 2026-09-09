import type { AwilixContainer } from 'awilix'
import { notFound } from '@open-mercato/shared/lib/crud/errors'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockRunRouteMutationGuards = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockRunRouteMutationGuards(...args),
}))

import * as listRoute from '../route'
import * as detailRoute from '../[id]/route'
import * as dueDateRoute from '../[id]/due-date/route'

const scope = { tenantId: 'tenant-1', organizationId: 'org-selected' }
const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-auth',
}
const invoiceId = '11111111-1111-4111-8111-111111111111'

function invoiceDto(overrides: Record<string, unknown> = {}) {
  return {
    id: invoiceId,
    sourceInvoiceId: 'source-1',
    origin: 'GOVERNMENT_PORTAL',
    direction: 'AP',
    companyId: '22222222-2222-4222-8222-222222222222',
    partnerName: 'Supplier',
    partnerTaxCode: '0100109106',
    sellerTaxCode: '0100109106',
    sellerName: 'Supplier',
    buyerTaxCode: '0301448888',
    buyerName: 'Buyer',
    invoiceSymbol: null,
    invoiceNumber: 'INV-1',
    invoiceCode: null,
    invoiceDate: '2026-01-10T00:00:00.000Z',
    dueDate: '2026-02-10T00:00:00.000Z',
    dueDateSource: null,
    currencyCode: 'VND',
    invoiceStatus: 'ACTIVE',
    netAmount: null,
    vatAmount: null,
    grossAmount: '120.0000',
    hasReceived: false,
    hasPaid: false,
    settlementStatus: 'UNSETTLED',
    settled: false,
    paidAmount: '0',
    outstandingAmount: '120.0000',
    nextDueDate: null,
    hasInstallmentPlan: false,
    nonRecoverable: false,
    nonRecoverableNote: null,
    nonRecoverableAt: null,
    lastSentAt: null,
    openedAt: null,
    autoSettled: false,
    autoPayExcluded: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function createRouteHarness(overrides: {
  listInvoices?: jest.Mock
  getInvoiceDetail?: jest.Mock
  commandExecute?: jest.Mock
} = {}) {
  const service = {
    listInvoices: overrides.listInvoices ?? jest.fn(),
    getInvoiceDetail: overrides.getInvoiceDetail ?? jest.fn(),
  }
  const commandBus = {
    execute: overrides.commandExecute ?? jest.fn(),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'invoiceService') return service
      if (token === 'commandBus') return commandBus
      if (token === 'em') return {}
      throw new Error(`Unknown token ${token}`)
    }),
  } as unknown as AwilixContainer

  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue(auth)
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: scope.organizationId,
    filterIds: [scope.organizationId],
  })
  mockResolveTranslations.mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })
  mockRunRouteMutationGuards.mockResolvedValue({
    ok: true,
    modifiedPayload: null,
    runAfterSuccess: jest.fn(),
  })

  return { commandBus, container, service }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('invoice invoices API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares auth and invoice view ACL metadata', () => {
    expect(listRoute.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.view'] })
    expect(detailRoute.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.view'] })
    expect(listRoute.metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
    expect(detailRoute.metadata.PUT).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
    expect(detailRoute.metadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
  })

  it('exports OpenAPI operation ids', () => {
    expect(listRoute.openApi.methods.GET?.operationId).toBe('invoice.invoices.list')
    expect(detailRoute.openApi.methods.GET?.operationId).toBe('invoice.invoices.detail')
    expect(listRoute.openApi.methods.POST?.operationId).toBe('invoice.invoices.create')
    expect(detailRoute.openApi.methods.PUT?.operationId).toBe('invoice.invoices.update')
    expect(detailRoute.openApi.methods.DELETE?.operationId).toBe('invoice.invoices.delete')
  })

  it('lists invoices through the service using trusted scope and ignores forged params', async () => {
    const { service } = createRouteHarness({
      listInvoices: jest.fn().mockResolvedValue({
        items: [invoiceDto()],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      }),
    })

    const response = await listRoute.GET(new Request(
      'https://example.test/api/invoice/invoices?tenantId=forged&organizationId=forged&direction=AP',
    ))

    expect(response.status).toBe(200)
    expect(service.listInvoices).toHaveBeenCalledWith(scope, expect.objectContaining({ direction: 'AP' }))
    expect(service.listInvoices.mock.calls[0]?.[1]).not.toHaveProperty('tenantId')
    expect(service.listInvoices.mock.calls[0]?.[1]).not.toHaveProperty('organizationId')
    expect(await readJson(response)).toEqual({
      items: [invoiceDto()],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    })
  })

  it('returns detail through the service using trusted scope', async () => {
    const { service } = createRouteHarness({
      getInvoiceDetail: jest.fn().mockResolvedValue({
        ...invoiceDto(),
        lineItems: [{ id: '33333333-3333-4333-8333-333333333333', lineNumber: 1 }],
        installments: [{ id: '44444444-4444-4444-8444-444444444444', sequence: 1 }],
      }),
    })

    const response = await detailRoute.GET(new Request(
      `https://example.test/api/invoice/invoices/${invoiceId}?tenantId=forged&organizationId=forged`,
    ), {
      params: { id: invoiceId },
    })

    expect(response.status).toBe(200)
    expect(service.getInvoiceDetail).toHaveBeenCalledWith(scope, invoiceId)
    const body = await readJson(response)
    expect(body).toMatchObject({ id: invoiceId, lineItems: expect.any(Array), installments: expect.any(Array) })
    expect(JSON.stringify(body)).not.toContain('emailTrackingTokenHash')
    expect(JSON.stringify(body)).not.toContain('tokenHash')
  })

  it('rejects unauthenticated and missing organization requests', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)

    const unauthenticated = await listRoute.GET(new Request('https://example.test/api/invoice/invoices'))
    expect(unauthenticated.status).toBe(401)

    createRouteHarness()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: null })
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })

    const missingScope = await listRoute.GET(new Request('https://example.test/api/invoice/invoices'))
    expect(missingScope.status).toBe(400)
  })

  it('maps invalid query or params to 400 and missing detail to 404', async () => {
    const { service } = createRouteHarness()

    const invalidQuery = await listRoute.GET(new Request('https://example.test/api/invoice/invoices?direction=OUT'))
    expect(invalidQuery.status).toBe(400)
    expect(service.listInvoices).not.toHaveBeenCalled()

    const invalidParam = await detailRoute.GET(new Request('https://example.test/api/invoice/invoices/nope'), {
      params: { id: 'nope' },
    })
    expect(invalidParam.status).toBe(400)

    createRouteHarness({
      getInvoiceDetail: jest.fn().mockRejectedValue(notFound('Invoice not found')),
    })
    const missing = await detailRoute.GET(new Request(`https://example.test/api/invoice/invoices/${invoiceId}`), {
      params: { id: invoiceId },
    })
    expect(missing.status).toBe(404)
  })

  it('creates manual invoices through guards and command bus with trusted scope', async () => {
    const commandExecute = jest.fn().mockResolvedValue({ result: { invoiceId, invoice: invoiceDto({ origin: 'MANUAL' }) } })
    createRouteHarness({ commandExecute })

    const response = await listRoute.POST(new Request('https://example.test/api/invoice/invoices?tenantId=forged', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: 'forged',
        organizationId: 'forged',
        buyerName: 'Forged Buyer',
        grossAmount: '999',
        partnerName: 'Foreign Seller',
        partnerCountryCode: 'SG',
        partnerTaxCode: 'SG-123',
        invoiceNumber: 'INV-2',
        invoiceDate: '2026-01-10',
        lineItems: [{ name: 'Line', quantity: '1', unitPrice: '100' }],
      }),
    }))

    expect(response.status).toBe(201)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }),
      input: expect.objectContaining({
        resourceKind: 'invoice.invoice',
        operation: 'create',
      }),
    }))
    expect(commandExecute).toHaveBeenCalledWith('invoice.invoices.create', expect.objectContaining({
      input: expect.not.objectContaining({
        tenantId: 'forged',
        organizationId: 'forged',
        buyerName: 'Forged Buyer',
        grossAmount: '999',
      }),
    }))
  })

  it('updates and deletes manual invoices through command bus', async () => {
    const commandExecute = jest.fn()
      .mockResolvedValueOnce({ result: { invoiceId, invoice: invoiceDto({ origin: 'MANUAL' }) } })
      .mockResolvedValueOnce({ result: { invoiceId, deleted: true } })
    createRouteHarness({ commandExecute })
    const requestBody = {
      partnerName: 'Foreign Seller',
      partnerCountryCode: 'SG',
      partnerTaxCode: 'SG-123',
      invoiceNumber: 'INV-3',
      invoiceDate: '2026-01-10',
      lineItems: [{ name: 'Line', quantity: '1', unitPrice: '100' }],
    }

    const update = await detailRoute.PUT(new Request(`https://example.test/api/invoice/invoices/${invoiceId}`, {
      method: 'PUT',
      body: JSON.stringify(requestBody),
    }), { params: { id: invoiceId } })
    const remove = await detailRoute.DELETE(new Request(`https://example.test/api/invoice/invoices/${invoiceId}`, {
      method: 'DELETE',
    }), { params: { id: invoiceId } })

    expect(update.status).toBe(200)
    expect(remove.status).toBe(200)
    expect(commandExecute).toHaveBeenNthCalledWith(1, 'invoice.invoices.update', expect.objectContaining({
      input: {
        id: invoiceId,
        input: expect.objectContaining({
          partnerName: requestBody.partnerName,
          partnerCountryCode: requestBody.partnerCountryCode,
          partnerTaxCode: requestBody.partnerTaxCode,
          invoiceNumber: requestBody.invoiceNumber,
          lineItems: requestBody.lineItems,
        }),
      },
    }))
    expect(commandExecute).toHaveBeenNthCalledWith(2, 'invoice.invoices.delete', expect.objectContaining({
      input: { id: invoiceId },
    }))
  })

  describe('due-date PATCH sub-route', () => {
    it('declares auth and invoice.manage ACL metadata', () => {
      expect(dueDateRoute.metadata.PATCH).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
    })

    it('exports the correct OpenAPI operation id', () => {
      expect(dueDateRoute.openApi.methods.PATCH?.operationId).toBe('invoice.invoices.due-date.update')
    })

    it('routes a valid PATCH to the command bus with trusted scope and correct command id', async () => {
      const commandExecute = jest.fn().mockResolvedValue({
        result: { invoiceId, invoice: invoiceDto({ dueDate: '2026-02-10T00:00:00.000Z' }) },
      })
      createRouteHarness({ commandExecute })

      const response = await dueDateRoute.PATCH(
        new Request(`https://example.test/api/invoice/invoices/${invoiceId}/due-date`, {
          method: 'PATCH',
          body: JSON.stringify({ dueDate: '2026-02-10' }),
        }),
        { params: { id: invoiceId } },
      )

      expect(response.status).toBe(200)
      expect(commandExecute).toHaveBeenCalledWith(
        'invoice.invoices.update-due-date',
        expect.objectContaining({
          input: expect.objectContaining({ id: invoiceId }),
        }),
      )
      expect(commandExecute.mock.calls[0]?.[1]?.input.input).toEqual({
        dueDate: new Date('2026-02-10T00:00:00.000Z'),
      })
      expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
        auth: expect.objectContaining({
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }),
        input: expect.objectContaining({
          resourceKind: 'invoice.invoice',
          operation: 'update',
        }),
      }))
    })

    it('ignores forged tenantId and organizationId in URL — uses auth-derived scope', async () => {
      const commandExecute = jest.fn().mockResolvedValue({
        result: { invoiceId, invoice: invoiceDto() },
      })
      createRouteHarness({ commandExecute })

      const response = await dueDateRoute.PATCH(
        new Request(
          `https://example.test/api/invoice/invoices/${invoiceId}/due-date?tenantId=forged&organizationId=forged`,
          { method: 'PATCH', body: JSON.stringify({ dueDate: '2026-02-10' }) },
        ),
        { params: { id: invoiceId } },
      )

      expect(response.status).toBe(200)
      // Scope comes from auth, never from URL params
      expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
        auth: expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-selected' }),
      }))
    })

    it('routes a clear PATCH to the command bus', async () => {
      const commandExecute = jest.fn().mockResolvedValue({
        result: { invoiceId, invoice: invoiceDto({ dueDate: null, nextDueDate: null }) },
      })
      createRouteHarness({ commandExecute })

      const response = await dueDateRoute.PATCH(
        new Request(`https://example.test/api/invoice/invoices/${invoiceId}/due-date`, {
          method: 'PATCH',
          body: JSON.stringify({ dueDate: null }),
        }),
        { params: { id: invoiceId } },
      )

      expect(response.status).toBe(200)
      expect(commandExecute).toHaveBeenCalledWith(
        'invoice.invoices.update-due-date',
        expect.objectContaining({
          input: {
            id: invoiceId,
            input: { dueDate: null },
          },
        }),
      )
      expect(await readJson(response)).toMatchObject({
        ok: true,
        invoice: {
          id: invoiceId,
          dueDate: null,
          nextDueDate: null,
        },
      })
    })

    it('returns 400 for an invalid body (non-date string) without calling the command bus', async () => {
      const commandExecute = jest.fn()
      createRouteHarness({ commandExecute })

      const response = await dueDateRoute.PATCH(
        new Request(`https://example.test/api/invoice/invoices/${invoiceId}/due-date`, {
          method: 'PATCH',
          body: JSON.stringify({ dueDate: 'not-a-date' }),
        }),
        { params: { id: invoiceId } },
      )

      expect(response.status).toBe(400)
      expect(commandExecute).not.toHaveBeenCalled()
    })

    it('returns mutation guard response without executing the command bus', async () => {
      const commandExecute = jest.fn()
      createRouteHarness({ commandExecute })
      mockRunRouteMutationGuards.mockResolvedValueOnce({
        ok: false,
        response: new Response(JSON.stringify({ error: 'blocked' }), { status: 403 }),
      })

      const response = await dueDateRoute.PATCH(
        new Request(`https://example.test/api/invoice/invoices/${invoiceId}/due-date`, {
          method: 'PATCH',
          body: JSON.stringify({ dueDate: '2026-02-10' }),
        }),
        { params: { id: invoiceId } },
      )

      expect(response.status).toBe(403)
      expect(commandExecute).not.toHaveBeenCalled()
    })

    it('returns 400 for an invalid invoice id param', async () => {
      createRouteHarness()

      const response = await dueDateRoute.PATCH(
        new Request('https://example.test/api/invoice/invoices/not-a-uuid/due-date', {
          method: 'PATCH',
          body: JSON.stringify({ dueDate: '2026-02-10' }),
        }),
        { params: { id: 'not-a-uuid' } },
      )

      expect(response.status).toBe(400)
    })
  })
})
