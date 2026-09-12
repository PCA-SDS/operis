import {
  isMockCarrierEnabled,
  MOCK_CARRIER_ENV,
  MOCK_CARRIER_PROVIDER_KEY,
} from '../mock-carrier-registration'

describe('isMockCarrierEnabled', () => {
  it('is off when the variable is absent', () => {
    expect(isMockCarrierEnabled({})).toBe(false)
  })

  it.each(['1', 'true', 'YES', 'on'])('is on for %p', (value) => {
    expect(isMockCarrierEnabled({ [MOCK_CARRIER_ENV]: value })).toBe(true)
  })

  /** `'0'` and `'false'` are truthy strings; a naive check would ship a fixture carrier. */
  it.each(['', '0', 'false', 'off'])('is off for %p', (value) => {
    expect(isMockCarrierEnabled({ [MOCK_CARRIER_ENV]: value })).toBe(false)
  })
})

describe('module import safety', () => {
  it('registers nothing at import time, and nothing without the flag', async () => {
    jest.resetModules()
    delete process.env[MOCK_CARRIER_ENV]
    const registry = await import('../adapter-registry')
    const { ensureMockCarrierRegistered } = await import('../mock-carrier-registration')
    expect(registry.getShippingAdapter(MOCK_CARRIER_PROVIDER_KEY)).toBeUndefined()
    ensureMockCarrierRegistered()
    expect(registry.getShippingAdapter(MOCK_CARRIER_PROVIDER_KEY)).toBeUndefined()
  })

  it('registers the carrier when the flag is set', async () => {
    jest.resetModules()
    process.env[MOCK_CARRIER_ENV] = '1'
    try {
      const registry = await import('../adapter-registry')
      const { ensureMockCarrierRegistered } = await import('../mock-carrier-registration')
      ensureMockCarrierRegistered()
      expect(registry.getShippingAdapter(MOCK_CARRIER_PROVIDER_KEY)).toBeDefined()
    } finally {
      delete process.env[MOCK_CARRIER_ENV]
    }
  })
})
