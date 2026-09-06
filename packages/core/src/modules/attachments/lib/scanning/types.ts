/**
 * Malware scanning for uploaded files.
 *
 * An abstraction rather than a direct client because the scanner is a
 * deployment decision, not a product one: a laptop has none, a container stack
 * has clamd on the network, and a managed environment may have something else
 * again. What the rest of the module needs is a verdict, and it must be the
 * same three answers whatever produced them.
 */

/**
 * What a scanner concluded.
 *
 * `failed` is deliberately distinct from `infected`. A scanner that could not
 * answer has told us nothing about the file, and the one thing that must not
 * happen is treating silence as safety — so both keep the file unreadable, and
 * only `failed` is worth retrying.
 */
export type ScanVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string | null }
  | { status: 'failed'; reason: string }

export type ScanRequest = {
  /** The bytes, when the caller already holds them. */
  buffer?: Buffer
  /** A local path, for scanners that read from disk rather than a socket. */
  filePath?: string
  fileName: string
  mimeType: string
  size: number
}

export interface AttachmentScanner {
  /** Recorded on the row, so an operator can tell what cleared a file. */
  readonly key: string
  /**
   * Whether this scanner actually inspects content.
   *
   * The one place this matters is scheduling: a scanner that inspects nothing
   * has no reason to occupy a queue, and a deployment without a scanner should
   * behave exactly as it did before scanning existed rather than parking every
   * upload behind a worker that will only ever say `clean`.
   */
  readonly inspects: boolean
  scan(request: ScanRequest): Promise<ScanVerdict>
}
