const mockFindOneWithDecryption = jest.fn()
const mockFetchWithTimeout = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/http/fetchWithTimeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
  resolveTimeoutMs: (value: number | undefined, fallback = 15_000) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback,
}))

import type { EntityManager } from '@mikro-orm/postgresql'

import { InvoiceCompanyRegistry } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import type { InvoiceCompanyLookupCachePayload } from '../../data/validators'
import {
  DataGovSgCompanyRegistryProvider,
  INVOICE_COMPANY_LOOKUP_CACHE_TTL_MS,
  InvoiceCompanyLookupService,
  InvoiceCompanyLookupUnavailableError,
  VietQrCompanyRegistryProvider,
  type CompanyRegistryProvider,
} from '../company-lookup-service'

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const now = new Date('2026-09-07T00:00:00.000Z')
const company = {
  name: 'Acme Vietnam',
  registrationNumber: '0100109106',
  taxCode: '0100109106',
  address: 'Hanoi',
  status: 'ACTIVE',
  sourceUpdatedAt: null,
}
const payload: InvoiceCompanyLookupCachePayload = {
  version: 1,
  normalized: company,
  rawProviderResponse: { secretProviderShape: { name: 'Acme Vietnam' } },
  providerFetchedAt: now.toISOString(),
}

function registry(overrides: Partial<InvoiceCompanyRegistry> = {}): InvoiceCompanyRegistry {
  return {
    id: 'registry-1',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    countryCode: 'VN',
    identifier: '0100109106',
    provider: 'vietqr',
    payload,
    fetchedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as InvoiceCompanyRegistry
}

function createEm() {
  return {
    create: jest.fn((_entity: unknown, row: unknown) => row),
    persist: jest.fn(),
    flush: jest.fn(),
    findOne: jest.fn(),
  } as unknown as EntityManager
}

function createProvider(overrides: Partial<CompanyRegistryProvider> = {}): CompanyRegistryProvider {
  return {
    providerKey: 'vietqr',
    countryCode: 'VN',
    lookup: jest.fn().mockResolvedValue({
      company,
      rawProviderResponse: { raw: true },
      fetchedAt: now,
    }),
    ...overrides,
  }
}

describe('InvoiceCompanyLookupService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.COMPANY_LOOKUP_FETCH_TIMEOUT_MS
    delete process.env.COMPANY_LOOKUP_VIETQR_URL
    delete process.env.COMPANY_LOOKUP_DATA_GOV_SG_URL
  })

  it('returns fresh encrypted cache without calling the provider', async () => {
    const em = createEm()
    const provider = createProvider()
    mockFindOneWithDecryption.mockResolvedValue(registry())
    const service = new InvoiceCompanyLookupService(em, [provider], () => now)

    const result = await service.lookup(scope, { country: 'VN', identifier: '010-0109106' })

    expect(result).toEqual({
      mode: 'registry',
      countryCode: 'VN',
      identifier: '0100109106',
      provider: 'vietqr',
      fetchedAt: now.toISOString(),
      stale: false,
      company,
    })
    expect(provider.lookup).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      InvoiceCompanyRegistry,
      {
        countryCode: 'VN',
        provider: 'vietqr',
        identifier: '0100109106',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      undefined,
      scope,
    )
    expect(jest.mocked(em.findOne)).not.toHaveBeenCalled()
  })

  it('writes provider results through entity persistence so encryption hooks can run', async () => {
    const em = createEm()
    const provider = createProvider()
    mockFindOneWithDecryption.mockResolvedValue(null)
    const service = new InvoiceCompanyLookupService(em, [provider], () => now)

    await service.lookup(scope, { country: 'VN', identifier: '0100109106' })

    expect(provider.lookup).toHaveBeenCalledWith('0100109106')
    expect(em.create).toHaveBeenCalledWith(InvoiceCompanyRegistry, expect.objectContaining({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      countryCode: 'VN',
      identifier: '0100109106',
      provider: 'vietqr',
      payload: expect.objectContaining({
        version: 1,
        normalized: company,
        rawProviderResponse: { raw: true },
      }),
      fetchedAt: now,
    }))
    expect(em.persist).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('uses stale cache when the provider is unavailable', async () => {
    const staleFetchedAt = new Date(now.getTime() - INVOICE_COMPANY_LOOKUP_CACHE_TTL_MS - 1)
    const em = createEm()
    const provider = createProvider({
      lookup: jest.fn().mockRejectedValue(new Error('provider down')),
    })
    mockFindOneWithDecryption.mockResolvedValue(registry({ fetchedAt: staleFetchedAt }))
    const service = new InvoiceCompanyLookupService(em, [provider], () => now)

    const result = await service.lookup(scope, { country: 'VN', identifier: '0100109106' })

    expect(result.stale).toBe(true)
    expect(result.fetchedAt).toBe(staleFetchedAt.toISOString())
  })

  it('fails with a controlled error when provider is unavailable and no cache exists', async () => {
    const em = createEm()
    const provider = createProvider({
      lookup: jest.fn().mockRejectedValue(new Error('provider down')),
    })
    mockFindOneWithDecryption.mockResolvedValue(null)
    const service = new InvoiceCompanyLookupService(em, [provider], () => now)

    await expect(service.lookup(scope, { country: 'VN', identifier: '0100109106' }))
      .rejects.toBeInstanceOf(InvoiceCompanyLookupUnavailableError)
  })

  it('returns manual mode for unsupported jurisdictions', async () => {
    const service = new InvoiceCompanyLookupService(createEm(), [], () => now)

    await expect(service.lookup(scope, { country: 'US', identifier: '123' })).resolves.toEqual({
      mode: 'manual',
      countryCode: 'US',
      identifier: '123',
      provider: null,
      fetchedAt: null,
      stale: false,
      company: null,
    })
  })

  it('rejects invalid country-aware identifiers', async () => {
    const service = new InvoiceCompanyLookupService(createEm(), [createProvider()], () => now)

    await expect(service.lookup(scope, { country: 'VN', identifier: 'abc' })).rejects.toMatchObject({ status: 400 })
    await expect(service.lookup(scope, { country: 'SG', identifier: 'bad' })).rejects.toMatchObject({ status: 400 })
  })
})

function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('company registry providers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('normalizes VietQR business payloads', async () => {
    mockFetchWithTimeout.mockResolvedValue(response({
      data: {
        name: 'Acme Vietnam',
        taxCode: '0100109106',
        address: 'Hanoi',
        status: 'ACTIVE',
      },
    }))

    await expect(new VietQrCompanyRegistryProvider().lookup('0100109106')).resolves.toMatchObject({
      company,
      rawProviderResponse: expect.any(Object),
    })
  })

  it('normalizes Singapore UEN payloads', async () => {
    mockFetchWithTimeout.mockResolvedValue(response({
      result: {
        records: [{
          entity_name: 'ACME SG PTE LTD',
          uen: '201912345Z',
          registered_address: 'Singapore',
          entity_status: 'LIVE',
        }],
      },
    }))

    await expect(new DataGovSgCompanyRegistryProvider().lookup('201912345Z')).resolves.toMatchObject({
      company: {
        name: 'ACME SG PTE LTD',
        registrationNumber: '201912345Z',
        taxCode: null,
        address: 'Singapore',
        status: 'LIVE',
        sourceUpdatedAt: null,
      },
    })
  })
})
