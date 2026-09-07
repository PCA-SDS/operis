import type { AttachmentScanner, ScanRequest, ScanVerdict } from './types'
import { ClamAvScanner } from './clamavScanner'

export type { AttachmentScanner, ScanRequest, ScanVerdict } from './types'
export { ClamAvScanner, interpretClamAvResponse } from './clamavScanner'

/**
 * The scanner used when a deployment has configured none.
 *
 * It clears everything, and that is a deliberate, documented position rather
 * than an oversight. Scanning arrived after attachments did, and six modules
 * already upload through this path; a default that quarantined their files
 * would turn an upgrade into an outage without anyone having asked for
 * scanning. So the gate is opt-in: configure a scanner and it is enforced for
 * every module at once, configure none and behaviour is exactly what it was.
 *
 * `inspects: false` is the honest part — callers can tell that nothing looked
 * at the bytes, which is what stops this being mistaken for a clean result.
 */
export class UnscannedAttachmentScanner implements AttachmentScanner {
  readonly key = 'unscanned'
  readonly inspects = false

  async scan(_request: ScanRequest): Promise<ScanVerdict> {
    return { status: 'clean' }
  }
}

const SCANNER_ENV_KEY = 'OM_ATTACHMENT_SCANNER'
const CLAMAV_HOST_ENV_KEYS = ['OM_ATTACHMENT_CLAMAV_HOST', 'CLAMAV_HOST']
const CLAMAV_PORT_ENV_KEYS = ['OM_ATTACHMENT_CLAMAV_PORT', 'CLAMAV_PORT']

function readEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

/**
 * The scanner this deployment is configured for.
 *
 * Resolved from the environment rather than from tenant settings: a scanner is
 * a property of where the process runs, and letting a tenant choose whether
 * their own uploads get scanned is not a setting worth having.
 */
export function resolveAttachmentScanner(): AttachmentScanner {
  const configured = (readEnv([SCANNER_ENV_KEY]) ?? 'none').toLowerCase()

  if (configured === 'clamav') {
    const host = readEnv(CLAMAV_HOST_ENV_KEYS)
    if (!host) {
      // Named but unreachable is a misconfiguration, not a preference. Falling
      // back to "clears everything" would silently undo the thing the operator
      // asked for, so this fails closed instead: every scan reports `failed`,
      // nothing becomes readable, and the reason says what to fix.
      return new MisconfiguredScanner(
        `${SCANNER_ENV_KEY}=clamav but no host is set (${CLAMAV_HOST_ENV_KEYS.join(' or ')})`,
      )
    }
    const port = Number(readEnv(CLAMAV_PORT_ENV_KEYS) ?? '')
    return new ClamAvScanner({ host, port: Number.isFinite(port) && port > 0 ? port : undefined })
  }

  return new UnscannedAttachmentScanner()
}

/** A scanner that was asked for but cannot run; every verdict is `failed`. */
export class MisconfiguredScanner implements AttachmentScanner {
  readonly key = 'misconfigured'
  readonly inspects = true

  constructor(private readonly reason: string) {}

  async scan(_request: ScanRequest): Promise<ScanVerdict> {
    return { status: 'failed', reason: this.reason }
  }
}
