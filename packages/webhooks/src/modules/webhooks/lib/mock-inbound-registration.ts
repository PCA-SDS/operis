import { registerWebhookEndpointAdapter } from './adapter-registry'
import { mockWebhookEndpointAdapter } from './mock-inbound-adapter'

/**
 * Registration of the mock inbound endpoint, gated on one environment flag.
 *
 * Separate from the adapter for the same reason the payment and carrier mocks
 * are: nothing is registered at import time, so a build that does not set the
 * flag cannot expose an unauthenticated-by-default receiver at
 * `/api/webhooks/inbound/mock_inbound`. Mirrors
 * `push_notifications/lib/push-stub-adapter.ts`.
 */

export const MOCK_INBOUND_ENV = 'OM_ENABLE_MOCK_INBOUND_WEBHOOK'

export function isMockInboundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[MOCK_INBOUND_ENV]
  if (typeof raw !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

let registered = false

/** Register the mock inbound endpoint once, ONLY when the test env flag is set. */
export function ensureMockInboundAdapterRegistered(): void {
  if (!isMockInboundEnabled()) return
  if (registered) return
  registered = true
  registerWebhookEndpointAdapter(mockWebhookEndpointAdapter)
}
