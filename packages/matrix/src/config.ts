import { z } from 'zod'
import { MatrixConfigError } from './errors'
import type { MatrixIdentityConfig } from './identity'

/**
 * Appservice credentials, as they arrive from the environment or the encrypted
 * credential store. Validated once at the edge so nothing downstream has to
 * defend against a missing token or a malformed URL.
 */
export const matrixCredentialsSchema = z.object({
  /** Base URL of the homeserver's client-server API, e.g. `http://127.0.0.1:8008`. */
  homeserverUrl: z.string().min(1),
  /** The `:domain` half of every id on this homeserver, e.g. `operis.local`. */
  serverName: z.string().min(1).max(255),
  /**
   * `as_token` from the registration. Grants the ability to act as any user in
   * the namespace, so it is a high-value secret: never log it, never put it in a
   * query string, never return it from an API.
   */
  asToken: z.string().min(32),
  /**
   * `hs_token` from the registration — how the homeserver proves a pushed
   * transaction is really from it. Optional while the appservice is pull-only
   * (`url: null`), required once push mode is enabled.
   */
  hsToken: z.string().min(32).optional(),
  senderLocalpart: z.string().min(1).max(255).default('operis'),
  userPrefix: z.string().min(1).max(64).default('om_'),
  botLocalpart: z.string().min(1).max(255).default('om_bot'),
})

export type MatrixCredentials = z.infer<typeof matrixCredentialsSchema>

export type MatrixConfig = MatrixIdentityConfig & {
  /** Normalised: no trailing slash, so path concatenation is unambiguous. */
  baseUrl: string
  asToken: string
  hsToken?: string
}

const LOCALPART_PATTERN = /^[a-z0-9._=/+-]+$/
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/

/**
 * Hosts for which plain `http` is acceptable.
 *
 * A Docker service name has no dot, which is why a dotless hostname counts as
 * private — `http://synapse:8008` is the normal way the app reaches the
 * homeserver inside compose, and demanding TLS there would mean either a
 * self-signed certificate in every developer's trust store or an env var that
 * disables the check entirely. Everything publicly resolvable must use https.
 */
function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === '::1' || hostname === '[::1]') return true
  if (!hostname.includes('.')) return true
  if (/^127\./.test(hostname)) return true
  if (/^10\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  return false
}

/**
 * The homeserver URL is operator-supplied and this process will send it a
 * credential, so it is validated the way any outbound-request target is.
 */
function assertSafeHomeserverUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new MatrixConfigError('[internal] homeserverUrl is not a valid URL', 'homeserverUrl')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MatrixConfigError('[internal] homeserverUrl must use http or https', 'homeserverUrl')
  }
  if (url.username || url.password) {
    // Credentials in the URL would be logged by anything that logs the URL.
    throw new MatrixConfigError(
      '[internal] homeserverUrl must not embed credentials',
      'homeserverUrl',
    )
  }
  if (url.search || url.hash) {
    throw new MatrixConfigError(
      '[internal] homeserverUrl must be an origin, without query or fragment',
      'homeserverUrl',
    )
  }
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    throw new MatrixConfigError(
      '[internal] homeserverUrl must use https for a publicly resolvable host',
      'homeserverUrl',
    )
  }
  return url
}

export function resolveMatrixConfig(input: unknown): MatrixConfig {
  const parsed = matrixCredentialsSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new MatrixConfigError(
      `[internal] invalid Matrix credentials: ${first?.message ?? 'unknown'}`,
      first?.path?.[0] === undefined ? undefined : String(first.path[0]),
    )
  }
  const credentials = parsed.data

  const url = assertSafeHomeserverUrl(credentials.homeserverUrl)

  if (!SERVER_NAME_PATTERN.test(credentials.serverName)) {
    throw new MatrixConfigError('[internal] serverName is not a valid Matrix domain', 'serverName')
  }
  for (const [field, value] of [
    ['senderLocalpart', credentials.senderLocalpart],
    ['botLocalpart', credentials.botLocalpart],
    ['userPrefix', credentials.userPrefix],
  ] as const) {
    if (!LOCALPART_PATTERN.test(value)) {
      throw new MatrixConfigError(
        `[internal] ${field} contains characters that are not valid in a Matrix localpart`,
        field,
      )
    }
  }
  if (credentials.botLocalpart === credentials.senderLocalpart) {
    // Synapse refuses /sync for the appservice's own sender (matrix-doc#1144),
    // so a configuration that makes them the same produces a homeserver that
    // accepts every write and can never read anything back.
    throw new MatrixConfigError(
      '[internal] botLocalpart must differ from senderLocalpart — Synapse refuses /sync for the appservice sender',
      'botLocalpart',
    )
  }
  if (!credentials.botLocalpart.startsWith(credentials.userPrefix)) {
    throw new MatrixConfigError(
      '[internal] botLocalpart must start with userPrefix so it falls inside the exclusive namespace',
      'botLocalpart',
    )
  }

  return {
    baseUrl: url.toString().replace(/\/+$/, ''),
    serverName: credentials.serverName,
    asToken: credentials.asToken,
    hsToken: credentials.hsToken,
    senderLocalpart: credentials.senderLocalpart,
    userPrefix: credentials.userPrefix,
    botLocalpart: credentials.botLocalpart,
  }
}

/**
 * Build a config from `OM_MATRIX_*` environment variables.
 *
 * Returns `null` when the homeserver URL is absent, which is the signal that
 * Matrix is simply not configured for this deployment — the overwhelmingly
 * common case while the transport is behind a flag. A partially configured
 * environment still throws, because that is a mistake rather than a choice.
 */
export function matrixConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MatrixConfig | null {
  if (!env.OM_MATRIX_HOMESERVER_URL) return null
  return resolveMatrixConfig({
    homeserverUrl: env.OM_MATRIX_HOMESERVER_URL,
    serverName: env.OM_MATRIX_SERVER_NAME,
    asToken: env.OM_MATRIX_AS_TOKEN,
    hsToken: env.OM_MATRIX_HS_TOKEN,
    senderLocalpart: env.OM_MATRIX_SENDER_LOCALPART,
    userPrefix: env.OM_MATRIX_USER_PREFIX,
    botLocalpart: env.OM_MATRIX_BOT_LOCALPART,
  })
}
