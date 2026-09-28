import type { Logger } from '../logger'
import { isEncryptionDebugEnabled } from './toggles'

/**
 * A debug logger that writes only while `TENANT_DATA_ENCRYPTION_DEBUG` is on and
 * never lets a logging failure reach the encryption path it is describing. The
 * toggle is read on every call, not captured, so turning it on takes effect
 * without a restart. Kept out of `toggles` because tests mock that module with
 * just its two switches.
 */
export function createEncryptionDebugLog(logger: Logger): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    if (!isEncryptionDebugEnabled()) return
    try {
      logger.debug(event, payload)
    } catch {
      // A failed debug line must not break encryption.
    }
  }
}
