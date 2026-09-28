/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/shipping_carriers/api/cancel/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const shipmentId = '44444444-4444-4444-8444-444444444444'

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const cancelShipmentMock = jest.fn()

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
        return { cancelShipment: cancelShipmentMock }
      }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

function createMockRequest(body: unknown): Request {
  return new Request('http://localhost/api/shipping-carriers/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validCancelPayload = {
  providerKey: 'test-carrier',
  shipmentId,
  reason: 'Customer requested',
}

describe('shipping carrier cancel route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
    cancelShipmentMock.mockResolvedValue({ status: 'cancelled' })
  })

  it('runs the mutation guard before cancelling a shipment', async () => {
    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container: expect.any(Object),
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'shipping_carriers.shipment',
          resourceId: shipmentId,
          operation: 'custom',
          mutationPayload: expect.objectContaining({ providerKey: 'test-carrier', shipmentId }),
        }),
      }),
    )
  })

  it('runs the guard after-success step once the shipment is cancelled', async () => {
    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(200)
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('returns the guard error response when the guard blocks cancellation', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({ ok: false, errorStatus: 422, errorBody: { error: 'blocked' } })

    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(422)
    expect(cancelShipmentMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('does not run the guard after-success step when the carrier call fails', async () => {
    cancelShipmentMock.mockRejectedValueOnce(new Error('carrier unavailable'))

    const response = await POST(createMockRequest(validCancelPayload))

    expect(response.status).toBe(502)
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })
})
