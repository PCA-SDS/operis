import { z } from 'zod'
import { MatrixConfigError } from './errors'
import { PERSONAL_ACCOUNT_PREFIX, type MatrixIdentityConfig } from './identity'

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
  /**
   * The bridges whose ghosts may speak in an external conversation: each
   * `network` label and the localpart `prefix` its ghosts carry. Empty — the
   * default — means no sender is ever an outsider, which is exactly the
   * behaviour before bridges existed.
   */
  bridgeGhosts: z
    .array(z.object({ network: z.string().min(1).max(32), prefix: z.string().min(1).max(64) }))
    .default([]),
  /**
   * The double-puppet registration's `as_token`. Acts only as account
   * identities (see `MatrixClient` scope `accounts`) — the one way to reach a
   * personal WhatsApp account. As sensitive as `asToken`.
   */
  doublePuppetAsToken: z.string().min(32).optional(),
  /**
   * Each bridge's provisioning API, by network: where logins start and the
   * shared secret that authorises them. A network listed here must also be in
   * `bridgeGhosts`, or its contacts would be unknown senders.
   */
  provisioning: z
    .record(z.string(), z.object({ url: z.string().min(1), secret: z.string().min(32) }))
    .default({}),
})

export type MatrixCredentials = z.infer<typeof matrixCredentialsSchema>

export type MatrixBridgeGhost = { network: string; prefix: string }

export type MatrixBridgeProvisioning = {
  /** Normalised origin of the bridge's appservice listener, e.g. `http://mautrix-whatsapp:29318`. */
  url: string
  /** `provisioning.shared_secret` — never log it, never send it anywhere but that origin. */
  secret: string
}

export type MatrixConfig = MatrixIdentityConfig & {
  /** Normalised: no trailing slash, so path concatenation is unambiguous. */
  baseUrl: string
  asToken: string
  hsToken?: string
  /** Bridge ghost namespaces an outsider may speak from. Absent means none. */
  bridgeGhosts?: readonly MatrixBridgeGhost[]
  /** The double-puppet token; see the credentials schema. Absent means no personal accounts. */
  doublePuppetAsToken?: string
  /** Bridge provisioning APIs by network. Absent means no account can be connected. */
  provisioning?: Readonly<Record<string, MatrixBridgeProvisioning>>
}

const LOCALPART_PATTERN = /^[a-z0-9._=/+-]+$/
const NETWORK_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
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
function assertSafeServiceUrl(raw: string, field: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new MatrixConfigError(`[internal] ${field} is not a valid URL`, field)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MatrixConfigError(`[internal] ${field} must use http or https`, field)
  }
  if (url.username || url.password) {
    // Credentials in the URL would be logged by anything that logs the URL.
    throw new MatrixConfigError(`[internal] ${field} must not embed credentials`, field)
  }
  if (url.search || url.hash) {
    throw new MatrixConfigError(`[internal] ${field} must be an origin, without query or fragment`, field)
  }
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    throw new MatrixConfigError(`[internal] ${field} must use https for a publicly resolvable host`, field)
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

  const url = assertSafeServiceUrl(credentials.homeserverUrl, 'homeserverUrl')

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

  const seenPrefixes = new Set<string>()
  for (const ghost of credentials.bridgeGhosts) {
    if (!NETWORK_PATTERN.test(ghost.network)) {
      throw new MatrixConfigError('[internal] a bridge network is a lowercase label such as whatsapp', 'bridgeGhosts')
    }
    if (!LOCALPART_PATTERN.test(ghost.prefix)) {
      throw new MatrixConfigError(
        '[internal] a bridge ghost prefix contains characters that are not valid in a Matrix localpart',
        'bridgeGhosts',
      )
    }
    // A prefix that reaches into Operis' own namespace would let the bot, the
    // appservice sender or a colleague's identity read as an outsider.
    // Nor into personal account identities, which would read as an outsider in
    // their own conversations.
    const overlapsOperis =
      ghost.prefix.startsWith(credentials.userPrefix) ||
      credentials.userPrefix.startsWith(ghost.prefix) ||
      credentials.senderLocalpart.startsWith(ghost.prefix) ||
      credentials.botLocalpart.startsWith(ghost.prefix) ||
      ghost.prefix.startsWith(PERSONAL_ACCOUNT_PREFIX) ||
      PERSONAL_ACCOUNT_PREFIX.startsWith(ghost.prefix)
    if (overlapsOperis) {
      throw new MatrixConfigError(
        '[internal] a bridge ghost prefix overlaps the Operis namespace, sender or bot',
        'bridgeGhosts',
      )
    }
    if (seenPrefixes.has(ghost.prefix)) {
      throw new MatrixConfigError('[internal] a bridge ghost prefix is listed twice', 'bridgeGhosts')
    }
    seenPrefixes.add(ghost.prefix)
  }

  const provisioning: Record<string, MatrixBridgeProvisioning> = {}
  for (const [network, entry] of Object.entries(credentials.provisioning)) {
    if (!NETWORK_PATTERN.test(network)) {
      throw new MatrixConfigError('[internal] a provisioning network is a lowercase label such as whatsapp', 'provisioning')
    }
    // A bridge whose logins work but whose contacts Operis cannot recognise
    // would deliver every customer message as an unknown sender — dropped.
    if (!credentials.bridgeGhosts.some((ghost) => ghost.network === network)) {
      throw new MatrixConfigError(
        `[internal] ${network} has a provisioning API but no entry in bridgeGhosts`,
        'provisioning',
      )
    }
    const serviceUrl = assertSafeServiceUrl(entry.url, 'provisioning')
    provisioning[network] = { url: serviceUrl.toString().replace(/\/+$/, ''), secret: entry.secret }
  }

  return {
    baseUrl: url.toString().replace(/\/+$/, ''),
    serverName: credentials.serverName,
    asToken: credentials.asToken,
    hsToken: credentials.hsToken,
    senderLocalpart: credentials.senderLocalpart,
    userPrefix: credentials.userPrefix,
    botLocalpart: credentials.botLocalpart,
    bridgeGhosts: credentials.bridgeGhosts,
    doublePuppetAsToken: credentials.doublePuppetAsToken,
    provisioning,
  }
}

/**
 * `OM_MATRIX_BRIDGE_GHOSTS`: comma-separated `network=prefix` pairs, such as
 * `whatsapp=whatsapp_,telegram=telegram_`. Unset or empty is no bridges. A
 * malformed pair throws rather than being skipped — a typo must not quietly
 * turn a bridge's messages back into drops.
 */
export function parseBridgeGhosts(raw: string | undefined): MatrixBridgeGhost[] {
  if (!raw || raw.trim().length === 0) return []
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const separator = pair.indexOf('=')
      const network = separator > 0 ? pair.slice(0, separator).trim() : ''
      const prefix = separator > 0 ? pair.slice(separator + 1).trim() : ''
      if (!network || !prefix) {
        throw new MatrixConfigError(
          '[internal] OM_MATRIX_BRIDGE_GHOSTS takes network=prefix pairs, comma-separated',
          'bridgeGhosts',
        )
      }
      return { network, prefix }
    })
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
    bridgeGhosts: parseBridgeGhosts(env.OM_MATRIX_BRIDGE_GHOSTS),
    doublePuppetAsToken: env.OM_MATRIX_DOUBLE_PUPPET_AS_TOKEN || undefined,
    provisioning: provisioningFromEnv(env),
  })
}

/**
 * `OM_MATRIX_WHATSAPP_PROVISIONING_URL` + `_SECRET`. Both or neither: one
 * without the other is a half-configured bridge, refused rather than ignored.
 */
function provisioningFromEnv(env: NodeJS.ProcessEnv): Record<string, { url: string; secret: string }> {
  const url = env.OM_MATRIX_WHATSAPP_PROVISIONING_URL?.trim()
  const secret = env.OM_MATRIX_WHATSAPP_PROVISIONING_SECRET?.trim()
  if (!url && !secret) return {}
  if (!url || !secret) {
    throw new MatrixConfigError(
      '[internal] OM_MATRIX_WHATSAPP_PROVISIONING_URL and _SECRET must be set together',
      'provisioning',
    )
  }
  return { whatsapp: { url, secret } }
}
