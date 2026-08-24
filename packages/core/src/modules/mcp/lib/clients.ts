import crypto from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { safeOutboundFetch } from '@open-mercato/shared/lib/url-safety'
import { McpOAuthClient } from '../data/entities'
import { filterKnownScopes, listMcpScopeValues } from './scope-registry'
import type { McpConnectionConfig } from './config'

const logger = createLogger('mcp').child({ component: 'oauth-clients' })

const BCRYPT_COST = 12
const CIMD_MAX_BYTES = 64 * 1024
const CIMD_TIMEOUT_MS = 5000

export type ResolvedMcpClient = {
  clientId: string
  clientName: string
  redirectUris: string[]
  allowedScopes: string[]
  isPublic: boolean
  registrationSource: 'preconfigured' | 'dynamic' | 'cimd'
  record: McpOAuthClient | null
}

/**
 * Redirect URIs are compared by exact string, never by prefix.
 *
 * A prefix or "starts-with" comparison is the classic open-redirect hole in an
 * OAuth server: `https://good.example/cb` would match
 * `https://good.example/cb.attacker.com`. The one concession is loopback, where
 * RFC 8252 requires the port to be ignored because native clients bind an
 * ephemeral one.
 */
export function redirectUriMatches(registered: string, candidate: string): boolean {
  if (registered === candidate) return true

  let registeredUrl: URL
  let candidateUrl: URL
  try {
    registeredUrl = new URL(registered)
    candidateUrl = new URL(candidate)
  } catch {
    return false
  }

  const isLoopback = (url: URL): boolean =>
    url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost'

  if (!isLoopback(registeredUrl) || !isLoopback(candidateUrl)) return false

  return (
    registeredUrl.protocol === candidateUrl.protocol &&
    registeredUrl.hostname === candidateUrl.hostname &&
    registeredUrl.pathname === candidateUrl.pathname &&
    registeredUrl.search === candidateUrl.search
  )
}

/**
 * A redirect URI must be https, or a loopback http URL (RFC 8252 native apps),
 * or a private-use scheme such as `myapp://cb`. Plain http to a remote host would
 * leak the authorization code in transit.
 */
export function isAcceptableRedirectUri(value: string, requireHttps: boolean): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash) return false

  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') {
    const loopback =
      url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost'
    return loopback
  }
  // Private-use URI scheme (RFC 8252 §7.1) — must be a reverse-DNS-ish scheme,
  // not one of the browser-navigable schemes an attacker could abuse.
  if (requireHttps) {
    return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && url.protocol.includes('.')
  }
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'vbscript:'].includes(url.protocol)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

/**
 * Client ID Metadata Document (CIMD): the client id *is* an https URL that serves
 * its own registration metadata. Preferred over Dynamic Client Registration for
 * interoperability because nothing is persisted server-side.
 *
 * The fetch is DNS-pinned and SSRF-guarded, size-capped, and never follows
 * redirects — a client id that redirects is rejected rather than chased.
 */
async function resolveClientIdMetadataDocument(
  clientId: string,
  config: McpConnectionConfig,
): Promise<ResolvedMcpClient | null> {
  if (!config.clientIdMetadataDocumentsEnabled) return null
  if (!clientId.startsWith('https://')) return null

  let response: Response
  try {
    response = await safeOutboundFetch(
      clientId,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      },
      { subject: 'MCP client id metadata document' },
    )
  } catch (error) {
    logger.warn('Client ID metadata document fetch rejected', {
      err: error instanceof Error ? error.message : String(error),
    })
    return null
  }

  if (response.status !== 200) return null

  const raw = await response.text()
  if (raw.length > CIMD_MAX_BYTES) return null

  let document: Record<string, unknown>
  try {
    document = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }

  // The document must claim the same client id it was fetched from, otherwise a
  // hosted JSON file could impersonate another client.
  if (document.client_id !== clientId) return null

  const redirectUris = toStringArray(document.redirect_uris).filter((uri) =>
    isAcceptableRedirectUri(uri, config.requireHttps),
  )
  if (redirectUris.length === 0) return null

  const requestedScopes =
    typeof document.scope === 'string' ? document.scope.split(/\s+/).filter(Boolean) : listMcpScopeValues()

  return {
    clientId,
    clientName: typeof document.client_name === 'string' ? document.client_name : clientId,
    redirectUris,
    allowedScopes: filterKnownScopes(requestedScopes),
    // CIMD clients are public: they hold no secret, PKCE is the only proof.
    isPublic: true,
    registrationSource: 'cimd',
    record: null,
  }
}

/**
 * Resolve a client id to its registration. Stored clients win; a CIMD lookup is
 * the fallback. Returns null when the client is unknown — callers must answer
 * with a generic `invalid_client` so this cannot be used to enumerate clients.
 */
export async function resolveMcpClient(
  em: EntityManager,
  clientId: string,
  config: McpConnectionConfig,
): Promise<ResolvedMcpClient | null> {
  if (!clientId || typeof clientId !== 'string' || clientId.length > 2048) return null

  const record = await em.findOne(McpOAuthClient, {
    clientId,
    isActive: true,
    deletedAt: null,
  })

  if (record) {
    return {
      clientId: record.clientId,
      clientName: record.clientName,
      redirectUris: record.redirectUris ?? [],
      allowedScopes: filterKnownScopes(record.allowedScopes ?? []),
      isPublic: !record.clientSecretHash,
      registrationSource: record.registrationSource,
      record,
    }
  }

  return resolveClientIdMetadataDocument(clientId, config)
}

export function generateClientSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export async function hashClientSecret(secret: string): Promise<string> {
  return hash(secret, BCRYPT_COST)
}

/**
 * Confidential-client authentication. Runs a bcrypt comparison even when no hash
 * is stored so a public client and a wrong secret take the same time.
 */
export async function verifyClientSecret(
  client: ResolvedMcpClient,
  providedSecret: string | null,
): Promise<boolean> {
  const storedHash = client.record?.clientSecretHash ?? null
  if (!storedHash) {
    // Public client: a secret must not be supplied at all.
    return providedSecret === null
  }
  if (!providedSecret) {
    await compare('placeholder', '$2a$12$0000000000000000000000000000000000000000000000000000')
      .catch(() => false)
    return false
  }
  return compare(providedSecret, storedHash)
}
