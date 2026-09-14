import {
  isMockGatewayEnabled,
  MOCK_GATEWAY_ENV,
  MOCK_GATEWAY_PROVIDER_KEYS,
} from '../mock-gateway-registration'

/**
 * The flag is the only thing standing between a fixture and a production
 * checkout, so what it accepts — and above all what it refuses — is the contract
 * worth pinning.
 */
describe('isMockGatewayEnabled', () => {
  it('is off when the variable is absent', () => {
    // The default that matters: every deployment that never heard of this flag.
    expect(isMockGatewayEnabled({})).toBe(false)
  })

  it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])('is on for %p', (value) => {
    expect(isMockGatewayEnabled({ [MOCK_GATEWAY_ENV]: value })).toBe(true)
  })

  /**
   * `''` and `'0'` are what a shell exports when someone tries to turn the flag
   * OFF, and `'false'` is what a config file writes. Treating any of them as
   * truthy — which a bare `Boolean(process.env.X)` would do for `'0'` and
   * `'false'` — would register a mock gateway in the one place it must not be.
   */
  it.each(['', '0', 'false', 'no', 'off', 'disabled', 'undefined'])(
    'is off for %p',
    (value) => {
      expect(isMockGatewayEnabled({ [MOCK_GATEWAY_ENV]: value })).toBe(false)
    },
  )

  it('names the three providers the specs distinguish', () => {
    expect([...MOCK_GATEWAY_PROVIDER_KEYS]).toEqual(['mock', 'mock_usd', 'mock_processing'])
  })
})

describe('module import safety', () => {
  /**
   * Importing the module must not register anything — registration happens only
   * through the explicit `ensureMockGatewayRegistered()` call in `di.ts`. If
   * that ever stops being true, a production build gains a payment gateway by
   * the mere act of loading a file.
   */
  it('registers nothing at import time', async () => {
    jest.resetModules()
    delete process.env[MOCK_GATEWAY_ENV]
    const registry = await import('@open-mercato/shared/modules/payment_gateways/types')
    await import('../mock-gateway-registration')
    for (const providerKey of MOCK_GATEWAY_PROVIDER_KEYS) {
      expect(registry.getGatewayAdapter(providerKey)).toBeUndefined()
    }
  })

  it('still registers nothing when the entry point runs without the flag', async () => {
    jest.resetModules()
    delete process.env[MOCK_GATEWAY_ENV]
    const registry = await import('@open-mercato/shared/modules/payment_gateways/types')
    const { ensureMockGatewayRegistered } = await import('../mock-gateway-registration')
    ensureMockGatewayRegistered()
    for (const providerKey of MOCK_GATEWAY_PROVIDER_KEYS) {
      expect(registry.getGatewayAdapter(providerKey)).toBeUndefined()
    }
  })

  it('registers the family when the flag is set', async () => {
    jest.resetModules()
    process.env[MOCK_GATEWAY_ENV] = '1'
    try {
      const registry = await import('@open-mercato/shared/modules/payment_gateways/types')
      const { ensureMockGatewayRegistered } = await import('../mock-gateway-registration')
      ensureMockGatewayRegistered()
      for (const providerKey of MOCK_GATEWAY_PROVIDER_KEYS) {
        expect(registry.getGatewayAdapter(providerKey)).toBeDefined()
      }
      // Idempotent: the DI registrar runs per request container.
      ensureMockGatewayRegistered()
      expect(registry.getGatewayAdapter('mock')).toBeDefined()
    } finally {
      delete process.env[MOCK_GATEWAY_ENV]
    }
  })
})
