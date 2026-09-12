import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ensureMockInboundAdapterRegistered } from './lib/mock-inbound-registration'

/**
 * The module registers no services of its own — this exists solely for the
 * test-only inbound endpoint, which needs a boot hook to attach itself to the
 * endpoint registry. Mirrors `push_notifications/di.ts`, which registers its
 * `push_stub` channel adapter the same way.
 */
export function register(_container: AppContainer) {
  // Test-only: expose `/api/webhooks/inbound/mock_inbound` when
  // `OM_ENABLE_MOCK_INBOUND_WEBHOOK` is set. A no-op otherwise, so no
  // deployment that omits the flag serves a fixture receiver.
  ensureMockInboundAdapterRegistered()
}
