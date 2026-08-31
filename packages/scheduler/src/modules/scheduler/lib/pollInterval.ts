import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'

export const DEFAULT_SCHEDULER_POLL_INTERVAL_MS = 30000
const POLL_INTERVAL_ENV = 'SCHEDULER_POLL_INTERVAL_MS'

/**
 * Poll interval for the local (non-BullMQ) scheduler engine.
 *
 * Parsed through `parseNumberWithDefault` so a malformed value falls back to the
 * default instead of yielding NaN, which would otherwise reach `setTimeout` and
 * the interval arithmetic in the CLI status output.
 */
export function getSchedulerPollIntervalMs(): number {
  return parseNumberWithDefault(process.env[POLL_INTERVAL_ENV], DEFAULT_SCHEDULER_POLL_INTERVAL_MS, {
    min: 1,
    integer: true,
  })
}
