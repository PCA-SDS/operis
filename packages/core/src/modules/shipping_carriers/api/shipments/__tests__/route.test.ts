/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/shipping_carriers/api/shipments/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const orderId = '44444444-4444-4444-8444-444444444444'

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const createShipmentMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    tenantId,
    orgId: organizationId,
    sub: userId,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'shippingCarrierService') {
        return { createShipment: createShipmentMock }
      }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

function createMockRequest(body: unknown): Request {
  return new Request('http://localhost/api/shipping-carriers/shipments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validCreatePayload = {
  providerKey: 'test-carrier',
  orderId,
  origin: { countryCode: 'PL', postalCode: '00-001', city: 'Warsaw', line1: 'Test 1' },
  destination: { countryCode: 'PL', postalCode: '00-002', city: 'Krakow', line1: 'Test 2' },
  packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
  serviceCode: 'standard',
}

describe('shipping carrier shipments route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
    createShipmentMock.mockResolvedValue({
      id: 'shipment-1',
      carrierShipmentId: 'carrier-1',
      trackingNumber: 'track-1',
      unifiedStatus: 'label_created',
      labelUrl: 'https://example.com/label.pdf',
    })
  })

  it('runs the mutation guard before creating a shipment', async () => {
    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(201)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container: expect.any(Object),
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'shipping_carriers.shipment',
          resourceId: orderId,
          operation: 'create',
          mutationPayload: expect.objectContaining({ providerKey: 'test-carrier', orderId }),
        }),
      }),
    )
  })

  it('runs the guard after-success step once the shipment is created', async () => {
    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(201)
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('returns the guard error response when the guard blocks creation', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({ ok: false, errorStatus: 422, errorBody: { error: 'blocked' } })

    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(422)
    expect(createShipmentMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('does not run the guard after-success step when the carrier call fails', async () => {
    createShipmentMock.mockRejectedValueOnce(new Error('carrier unavailable'))

    const response = await POST(createMockRequest(validCreatePayload))

    expect(response.status).toBe(502)
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })
})
