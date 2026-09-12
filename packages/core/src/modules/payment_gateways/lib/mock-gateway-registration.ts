import {
  registerGatewayAdapter,
  registerPaymentGatewayDescriptor,
  registerWebhookHandler,
  type PaymentGatewayDescriptorField,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { mockGatewayAdapter } from './mock-gateway-adapter'

/**
 * Registration of the mock gateway family, gated on one environment flag.
 *
 * Three providers rather than one, because the specs need three distinguishable
 * behaviours: `mock` is the ordinary case, `mock_usd` refuses every currency but
 * USD so the currency guard is exercisable, and `mock_processing` returns a
 * session that stays `pending` so the manual-capture path has something to
 * capture.
 *
 * Production safety is the whole reason this file exists separately from the
 * adapter: nothing is registered at import time, and {@link ensureMockGatewayRegistered}
 * returns immediately unless the flag is set. Mirrors
 * `push_notifications/lib/push-stub-adapter.ts`.
 */

export const MOCK_GATEWAY_ENV = 'OM_ENABLE_MOCK_PAYMENT_GATEWAY'

export const MOCK_GATEWAY_PROVIDER_KEYS = ['mock', 'mock_usd', 'mock_processing'] as const

export function isMockGatewayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[MOCK_GATEWAY_ENV]
  if (typeof raw !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

/**
 * The capture-method selector every mock provider offers.
 *
 * Shared rather than repeated three times: the three providers differ in which
 * currencies they accept and what status they return, not in how a session is
 * configured, and three copies of one array is three places for them to drift.
 */
function mockSessionFields(): PaymentGatewayDescriptorField[] {
  return [
    {
      key: 'captureMethod',
      label: 'Capture method',
      type: 'select',
      options: [
        { value: 'automatic', label: 'Automatic capture' },
        { value: 'manual', label: 'Manual capture' },
      ],
    },
  ]
}

/** The session id a mock webhook payload points at, or null when it names none. */
function readMockWebhookSessionId(payload: Record<string, unknown> | null): string | null {
  const data = payload?.data
  if (!data || typeof data !== 'object') return null
  const sessionId = (data as Record<string, unknown>).id
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : null
}

let registered = false

/**
 * Register the mock gateway family once, ONLY when the test env flag is set.
 *
 * Idempotent: the DI registrar runs per request container, and registering the
 * same provider key twice would leave the registry's last writer winning for no
 * reason.
 */
export function ensureMockGatewayRegistered(): void {
  if (!isMockGatewayEnabled()) return
  if (registered) return
  registered = true

  registerGatewayAdapter(mockGatewayAdapter)
  registerGatewayAdapter({ ...mockGatewayAdapter, providerKey: 'mock_usd' })
  registerGatewayAdapter({
    ...mockGatewayAdapter,
    providerKey: 'mock_processing',
    // Forced to manual capture and reported as pending, so a spec can drive the
    // authorize → capture path deterministically rather than racing a gateway
    // that settles immediately.
    async createSession(input) {
      const result = await mockGatewayAdapter.createSession({ ...input, captureMethod: 'manual' })
      return { ...result, status: 'pending' }
    },
  })

  for (const providerKey of MOCK_GATEWAY_PROVIDER_KEYS) {
    registerWebhookHandler(providerKey, mockGatewayAdapter.verifyWebhook, {
      readSessionIdHint: readMockWebhookSessionId,
    })
  }

  registerPaymentGatewayDescriptor({
    providerKey: 'mock',
    label: 'Mock Gateway',
    sessionConfig: {
      fields: mockSessionFields(),
      supportedCurrencies: '*',
      supportedPaymentTypes: [{ value: 'mock', label: 'Mock payment' }],
      presentation: 'either',
    },
  })
  registerPaymentGatewayDescriptor({
    providerKey: 'mock_usd',
    label: 'Mock Gateway (USD only)',
    sessionConfig: {
      fields: mockSessionFields(),
      // The point of this provider: a currency the gateway refuses, so the
      // guard that rejects an unsupported one has something to reject.
      supportedCurrencies: ['USD'],
      supportedPaymentTypes: [{ value: 'mock', label: 'Mock payment' }],
      presentation: 'either',
    },
  })
  registerPaymentGatewayDescriptor({
    providerKey: 'mock_processing',
    label: 'Mock Gateway (pending state)',
    sessionConfig: {
      fields: mockSessionFields(),
      supportedCurrencies: '*',
      supportedPaymentTypes: [{ value: 'mock', label: 'Mock payment' }],
      presentation: 'either',
    },
  })
}
