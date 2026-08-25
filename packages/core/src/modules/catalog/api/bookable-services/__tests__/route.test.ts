/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockListBookableServicesForOrganization = jest.fn()
const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('../../../lib/bookableServices', () => ({
  listBookableServicesForOrganization: (...args: unknown[]) =>
    mockListBookableServicesForOrganization(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

describe('catalog bookable-services route', () => {
  beforeEach(() => {
    jest.resetModules()
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => ({}) }),
    })
    mockListBookableServicesForOrganization.mockReset()
  })

  it('returns org-scoped bookable services for valid query', async () => {
    mockListBookableServicesForOrganization.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Signature Haircut',
        subtitle: null,
        description: null,
        handle: 'signature-haircut-service',
        currencyCode: 'USD',
        unitPriceNet: '95.0000',
        unitPriceGross: '95.0000',
        durationMinutes: 60,
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
    ])

    const { GET } = await import('../route')
    const response = await GET(
      new Request(
        'http://localhost/api/catalog/bookable-services?tenantId=22222222-2222-4222-8222-222222222222&organizationId=33333333-3333-4333-8333-333333333333',
      ),
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].title).toBe('Signature Haircut')
    expect(mockListBookableServicesForOrganization).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      },
    )
  })

  it('maps missing tenant/org to HTTP 404', async () => {
    mockListBookableServicesForOrganization.mockRejectedValue(
      new CrudHttpError(404, { error: 'Organization not found.', code: 'ORGANIZATION_NOT_FOUND' }),
    )

    const { GET } = await import('../route')
    const response = await GET(
      new Request(
        'http://localhost/api/catalog/bookable-services?tenantId=22222222-2222-4222-8222-222222222222&organizationId=33333333-3333-4333-8333-333333333333',
      ),
    )

    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload.code).toBe('ORGANIZATION_NOT_FOUND')
  })

  it('rejects missing query params with HTTP 400', async () => {
    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/catalog/bookable-services'))
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.code).toBe('INVALID_INPUT')
    expect(mockListBookableServicesForOrganization).not.toHaveBeenCalled()
  })
})
