import type { AwilixContainer } from 'awilix'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'

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

import * as listAddRoute from '../route'
import * as candidatesRoute from '../candidates/route'
import * as deleteRoute from '../[id]/route'
import * as reverseRoute from '../../invoices/[id]/reverse-auto-paid/route'
import { Invoice, InvoiceAutoPaidTaxCode } from '../../../data/entities'
import { InvoiceAutoPaidService } from '../../../services/auto-paid-service'

const scope = { tenantId: 'tenant-1', organizationId: 'org-selected' }
const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-auth',
}
const ruleId = '11111111-1111-4111-8111-111111111111'
const invoiceId = '22222222-2222-4222-8222-222222222222'

function autoPaidRule(overrides: Record<string, unknown> = {}) {
  return {
    id: ruleId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    taxCode: '0100109106',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function createRouteHarness(overrides: {
  listRules?: jest.Mock
  listCandidates?: jest.Mock
  commandExecute?: jest.Mock
  runAfterSuccess?: jest.Mock
} = {}) {
  const service = {
    listRules: overrides.listRules ?? jest.fn(),
    listCandidates: overrides.listCandidates ?? jest.fn(),
  }
  const commandBus = {
    execute: overrides.commandExecute ?? jest.fn(),
  }
  const runAfterSuccess = overrides.runAfterSuccess ?? jest.fn()
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'invoiceAutoPaidService') return service
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
    runAfterSuccess,
  })

  return { container, service, commandBus, runAfterSuccess }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('invoice auto-paid API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares correct auth and ACL metadata for every route', () => {
    expect(listAddRoute.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.settings.manage'] })
    expect(listAddRoute.metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['invoice.settings.manage'] })
    expect(candidatesRoute.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.settings.manage'] })
    expect(deleteRoute.metadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['invoice.settings.manage'] })
    expect(reverseRoute.metadata.PATCH).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
  })

  it('exports OpenAPI metadata for every route', () => {
    expect(listAddRoute.openApi.methods.GET?.operationId).toBe('invoice.autoPaid.list')
    expect(listAddRoute.openApi.methods.POST?.operationId).toBe('invoice.autoPaid.add')
    expect(candidatesRoute.openApi.methods.GET?.operationId).toBe('invoice.autoPaid.candidates')
    expect(deleteRoute.openApi.methods.DELETE?.operationId).toBe('invoice.autoPaid.remove')
    expect(reverseRoute.openApi.methods.PATCH?.operationId).toBe('invoice.invoices.reverseAutoPaid')
  })

  it('requires auth across all auto-paid routes', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)

    const listRes = await listAddRoute.GET(new Request('https://example.test/api/invoice/auto-paid'))
    expect(listRes.status).toBe(401)

    const addRes = await listAddRoute.POST(new Request('https://example.test/api/invoice/auto-paid', {
      method: 'POST',
      body: JSON.stringify({ taxCode: '0100109106' }),
    }))
    expect(addRes.status).toBe(401)

    const candidatesRes = await candidatesRoute.GET(new Request('https://example.test/api/invoice/auto-paid/candidates'))
    expect(candidatesRes.status).toBe(401)

    const deleteRes = await deleteRoute.DELETE(new Request(`https://example.test/api/invoice/auto-paid/${ruleId}`), {
      params: { id: ruleId },
    })
    expect(deleteRes.status).toBe(401)

    const reverseRes = await reverseRoute.PATCH(new Request(`https://example.test/api/invoice/invoices/${invoiceId}/reverse-auto-paid`, {
      method: 'PATCH',
    }), {
      params: { id: invoiceId },
    })
    expect(reverseRes.status).toBe(401)
  })

  it('returns 400 when organization context is missing', async () => {
    createRouteHarness()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: null })
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })

    const response = await listAddRoute.GET(new Request('https://example.test/api/invoice/auto-paid'))
    expect(response.status).toBe(400)
  })

  it('lists rules using trusted scope and ignores forged scope query params', async () => {
    const { service } = createRouteHarness({
      listRules: jest.fn().mockResolvedValue([autoPaidRule()]),
    })

    const response = await listAddRoute.GET(new Request(
      'https://example.test/api/invoice/auto-paid?tenantId=forged&organizationId=forged',
    ))

    expect(response.status).toBe(200)
    expect(service.listRules).toHaveBeenCalledWith(scope)
    expect(await readJson(response)).toEqual({
      items: [
        {
          id: ruleId,
          taxCode: '0100109106',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  })

  it('delegates candidates listing to service using trusted scope and ignores forged params', async () => {
    const candidates = [
      { taxCode: '0105678999', invoiceCount: 1 },
      { taxCode: '0301448888', invoiceCount: 2 },
    ]
    const { service, commandBus } = createRouteHarness({
      listCandidates: jest.fn().mockResolvedValue(candidates),
    })

    const response = await candidatesRoute.GET(new Request(
      'https://example.test/api/invoice/auto-paid/candidates?tenantId=forged&organizationId=forged',
    ))

    expect(response.status).toBe(200)
    expect(service.listCandidates).toHaveBeenCalledWith(scope)
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(await readJson(response)).toEqual({ items: candidates })
  })

  it('candidate route excludes synthetic and already-configured tax codes', async () => {
    const mockPersistence = {
      findMany: jest.fn((entity: unknown) => {
        if (entity === InvoiceAutoPaidTaxCode) {
          return Promise.resolve([autoPaidRule({ taxCode: '0100109106' })])
        }
        return Promise.resolve([
          { sellerTaxCode: '0100109106' },
          { sellerTaxCode: '0301448888' },
          { sellerTaxCode: '0301448888' },
          { sellerTaxCode: 'auto:supplier-1' },
          { sellerTaxCode: 'AUTO:supplier-2' },
          { sellerTaxCode: '   ' },
          { sellerTaxCode: null },
          { sellerTaxCode: '0105678999' },
        ])
      }),
    }
    const realService = new InvoiceAutoPaidService({} as any, mockPersistence as any)
    const { container } = createRouteHarness()
    jest.mocked(container.resolve).mockImplementation((token: string) => {
      if (token === 'invoiceAutoPaidService') return realService
      if (token === 'commandBus') return { execute: jest.fn() }
      if (token === 'em') return {}
      throw new Error(`Unknown token ${token}`)
    })

    const response = await candidatesRoute.GET(new Request('https://example.test/api/invoice/auto-paid/candidates'))
    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({
      items: [
        { taxCode: '0105678999', invoiceCount: 1 },
        { taxCode: '0301448888', invoiceCount: 2 },
      ],
    })
  })

  it('rejects invalid input on POST, DELETE, and PATCH with 400', async () => {
    const { commandBus } = createRouteHarness()

    // Invalid body on POST: empty taxCode
    const postRes1 = await listAddRoute.POST(new Request('https://example.test/api/invoice/auto-paid', {
      method: 'POST',
      body: JSON.stringify({ taxCode: '   ' }),
    }))
    expect(postRes1.status).toBe(400)

    // Invalid body on POST: extra fields (strict schema)
    const postRes2 = await listAddRoute.POST(new Request('https://example.test/api/invoice/auto-paid', {
      method: 'POST',
      body: JSON.stringify({ taxCode: '0100109106', extra: 'bad' }),
    }))
    expect(postRes2.status).toBe(400)

    // Invalid param on DELETE: not a uuid
    const delRes = await deleteRoute.DELETE(new Request('https://example.test/api/invoice/auto-paid/not-a-uuid'), {
      params: { id: 'not-a-uuid' },
    })
    expect(delRes.status).toBe(400)

    // Invalid param on PATCH: not a uuid
    const patchRes = await reverseRoute.PATCH(new Request('https://example.test/api/invoice/invoices/not-a-uuid/reverse-auto-paid', {
      method: 'PATCH',
    }), {
      params: { id: 'not-a-uuid' },
    })
    expect(patchRes.status).toBe(400)

    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('runs mutation guards and executes invoice.auto_paid.add on POST', async () => {
    const commandExecute = jest.fn().mockResolvedValue({
      result: {
        ruleId,
        taxCode: '0100109106',
        settledCount: 3,
      },
    })
    const { container, runAfterSuccess } = createRouteHarness({ commandExecute })

    const req = new Request('https://example.test/api/invoice/auto-paid', {
      method: 'POST',
      body: JSON.stringify({ taxCode: '0100109106' }),
    })
    const response = await listAddRoute.POST(req)

    expect(response.status).toBe(200)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      container,
      input: {
        resourceKind: 'invoice.auto_paid_tax_code',
        operation: 'create',
        mutationPayload: { taxCode: '0100109106' },
      },
    }))
    expect(commandExecute).toHaveBeenCalledWith('invoice.auto_paid.add', expect.objectContaining({
      input: { taxCode: '0100109106' },
      ctx: expect.objectContaining({
        selectedOrganizationId: scope.organizationId,
      }),
    }))
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(await readJson(response)).toEqual({
      ok: true,
      ruleId,
      taxCode: '0100109106',
      settledCount: 3,
    })
  })

  it('delegates repeated add to idempotent upsert path with settledCount: 0', async () => {
    const commandExecute = jest.fn().mockResolvedValue({
      result: {
        ruleId,
        taxCode: '0100109106',
        settledCount: 0,
      },
    })
    createRouteHarness({ commandExecute })

    const req = new Request('https://example.test/api/invoice/auto-paid', {
      method: 'POST',
      body: JSON.stringify({ taxCode: '0100109106' }),
    })
    const response = await listAddRoute.POST(req)

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({
      ok: true,
      ruleId,
      taxCode: '0100109106',
      settledCount: 0,
    })
  })

  it('runs mutation guards and executes invoice.auto_paid.remove on DELETE', async () => {
    const commandExecute = jest.fn().mockResolvedValue({
      result: {
        ruleId,
        taxCode: '0100109106',
        revertedCount: 2,
      },
    })
    const { container, runAfterSuccess } = createRouteHarness({ commandExecute })

    const req = new Request(`https://example.test/api/invoice/auto-paid/${ruleId}`, { method: 'DELETE' })
    const response = await deleteRoute.DELETE(req, { params: { id: ruleId } })

    expect(response.status).toBe(200)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      container,
      input: {
        resourceKind: 'invoice.auto_paid_tax_code',
        resourceId: ruleId,
        operation: 'delete',
        mutationPayload: { id: ruleId },
      },
    }))
    expect(commandExecute).toHaveBeenCalledWith('invoice.auto_paid.remove', expect.objectContaining({
      input: { id: ruleId },
      ctx: expect.objectContaining({
        selectedOrganizationId: scope.organizationId,
      }),
    }))
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(await readJson(response)).toEqual({
      ok: true,
      ruleId,
      taxCode: '0100109106',
      revertedCount: 2,
    })
  })

  it('maps domain notFound error on DELETE to 404', async () => {
    const commandExecute = jest.fn().mockRejectedValue(notFound('Invoice auto-paid rule not found'))
    createRouteHarness({ commandExecute })

    const response = await deleteRoute.DELETE(new Request(`https://example.test/api/invoice/auto-paid/${ruleId}`), {
      params: { id: ruleId },
    })

    expect(response.status).toBe(404)
  })

  it('runs mutation guards and executes invoice.auto_paid.reverse on PATCH', async () => {
    const commandExecute = jest.fn().mockResolvedValue({
      result: {
        invoiceId,
        reversed: true,
      },
    })
    const { container, runAfterSuccess } = createRouteHarness({ commandExecute })

    const req = new Request(`https://example.test/api/invoice/invoices/${invoiceId}/reverse-auto-paid`, { method: 'PATCH' })
    const response = await reverseRoute.PATCH(req, { params: { id: invoiceId } })

    expect(response.status).toBe(200)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      container,
      input: {
        resourceKind: 'invoice.invoice',
        resourceId: invoiceId,
        operation: 'update',
        mutationPayload: { invoiceId },
      },
    }))
    expect(commandExecute).toHaveBeenCalledWith('invoice.auto_paid.reverse', expect.objectContaining({
      input: { invoiceId },
      ctx: expect.objectContaining({
        selectedOrganizationId: scope.organizationId,
      }),
    }))
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(await readJson(response)).toEqual({
      ok: true,
      invoiceId,
      reversed: true,
    })
  })

  it('maps domain badRequest error on PATCH reverse to 400', async () => {
    const commandExecute = jest.fn().mockRejectedValue(badRequest('Invoice is not auto-settled'))
    createRouteHarness({ commandExecute })

    const response = await reverseRoute.PATCH(new Request(`https://example.test/api/invoice/invoices/${invoiceId}/reverse-auto-paid`), {
      params: { id: invoiceId },
    })

    expect(response.status).toBe(400)
  })

  it('maps unexpected errors to 500', async () => {
    const commandExecute = jest.fn().mockRejectedValue(new Error('Database exploded'))
    createRouteHarness({ commandExecute })

    const response = await listAddRoute.POST(new Request('https://example.test/api/invoice/auto-paid', {
      method: 'POST',
      body: JSON.stringify({ taxCode: '0100109106' }),
    }))

    expect(response.status).toBe(500)
  })
})

