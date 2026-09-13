import { registerShippingAdapter } from './adapter-registry'
import { mockShippingAdapter } from './mock-carrier-adapter'

/**
 * Registration of the mock carrier, gated on one environment flag.
 *
 * Separate from the adapter itself for the same reason the payment side is:
 * nothing is registered at import time, so a build that does not set the flag
 * cannot end up quoting rates and printing labels from a fixture. Mirrors
 * `push_notifications/lib/push-stub-adapter.ts`.
 */

export const MOCK_CARRIER_ENV = 'OM_ENABLE_MOCK_SHIPPING_CARRIER'

export const MOCK_CARRIER_PROVIDER_KEY = 'mock_carrier'

export function isMockCarrierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[MOCK_CARRIER_ENV]
  if (typeof raw !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

let registered = false

/** Register the mock carrier once, ONLY when the test env flag is set. No-op otherwise. */
export function ensureMockCarrierRegistered(): void {
  if (!isMockCarrierEnabled()) return
  if (registered) return
  registered = true
  registerShippingAdapter(mockShippingAdapter)
}
