import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'

/**
 * Every environment-specific value the MCP connection needs. Nothing here is
 * hard-coded to a domain, tenant or client — a deployment is configured purely
 * through the environment.
 */
export type McpConnectionConfig = {
  /** Public origin the MCP endpoint and OAuth endpoints are reachable on. */
  publicUrl: string
  /** Canonical resource identifier (RFC 8707) — also the token `aud` claim. */
  resourceUrl: string
  /** OAuth issuer identifier (RFC 8414 `issuer`). */
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  accessTokenTtlSeconds: number
  refreshTokenTtlSeconds: number
  authorizationCodeTtlSeconds: number
  /** RFC 7591 Dynamic Client Registration — off unless explicitly enabled. */
  dynamicRegistrationEnabled: boolean
  /** Client ID Metadata Documents — https client ids that serve their metadata. */
  clientIdMetadataDocumentsEnabled: boolean
  requireHttps: boolean
}

export const MCP_RESOURCE_PATH = '/api/mcp/tasks'
export const MCP_AUTHORIZE_PATH = '/api/mcp/oauth/authorize'
export const MCP_TOKEN_PATH = '/api/mcp/oauth/token'
export const MCP_REGISTER_PATH = '/api/mcp/oauth/register'
export const MCP_CONSENT_PATH = '/backend/mcp/consent'

/** Audience label used to derive the MCP access-token signing key from JWT_SECRET. */
export const MCP_TOKEN_KEY_AUDIENCE = 'mcp'

/** Marks a JWT as an MCP access token so no other token shape can stand in. */
export const MCP_TOKEN_USE = 'mcp_access'

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 600
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14
const DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS = 60

/** Access tokens stay short-lived: an operator may tune the TTL, never remove the ceiling. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function stripTrailingSlash(value: string): string {
  let end = value.length
  while (end > 1 && value.charCodeAt(end - 1) === 47 /* '/' */) end--
  return value.slice(0, end)
}

class McpConfigurationError extends Error {}

/**
 * Resolve the public origin. `MCP_PUBLIC_URL` wins so an operator can publish the
 * MCP endpoint on a dedicated hostname; otherwise the app's own configured URL is
 * used. A request origin is accepted only outside production — deriving the
 * issuer from an attacker-controlled Host header would let a forged
 * `WWW-Authenticate` point clients at a hostile authorization server.
 */
function resolvePublicUrl(requestOrigin?: string | null): string {
  const configured =
    process.env.MCP_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim()

  if (configured) return stripTrailingSlash(configured)

  if (process.env.NODE_ENV === 'production') {
    throw new McpConfigurationError(
      '[internal] MCP_PUBLIC_URL (or APP_URL) must be set in production so OAuth metadata cannot be derived from a request Host header.',
    )
  }

  if (requestOrigin && requestOrigin.trim()) return stripTrailingSlash(requestOrigin.trim())
  return 'http://localhost:3000'
}

export function getMcpConnectionConfig(requestOrigin?: string | null): McpConnectionConfig {
  const publicUrl = resolvePublicUrl(requestOrigin)
  const issuer = stripTrailingSlash(process.env.MCP_OAUTH_ISSUER?.trim() || publicUrl)
  const resourceUrl = stripTrailingSlash(
    process.env.MCP_OAUTH_RESOURCE?.trim() || `${publicUrl}${MCP_RESOURCE_PATH}`,
  )

  return {
    publicUrl,
    resourceUrl,
    issuer,
    authorizationEndpoint: `${publicUrl}${MCP_AUTHORIZE_PATH}`,
    tokenEndpoint: `${publicUrl}${MCP_TOKEN_PATH}`,
    registrationEndpoint: `${publicUrl}${MCP_REGISTER_PATH}`,
    accessTokenTtlSeconds: clamp(
      parseNumberWithDefault(process.env.MCP_ACCESS_TOKEN_TTL_SECONDS, DEFAULT_ACCESS_TOKEN_TTL_SECONDS, {
        min: 60,
        integer: true,
      }),
      60,
      3600,
    ),
    refreshTokenTtlSeconds: parseNumberWithDefault(
      process.env.MCP_REFRESH_TOKEN_TTL_SECONDS,
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
      { min: 300, integer: true },
    ),
    authorizationCodeTtlSeconds: clamp(
      parseNumberWithDefault(
        process.env.MCP_AUTHORIZATION_CODE_TTL_SECONDS,
        DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS,
        { min: 10, integer: true },
      ),
      10,
      600,
    ),
    dynamicRegistrationEnabled: parseBooleanWithDefault(
      process.env.MCP_OAUTH_DYNAMIC_REGISTRATION,
      false,
    ),
    clientIdMetadataDocumentsEnabled: parseBooleanWithDefault(
      process.env.MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS,
      true,
    ),
    requireHttps: process.env.NODE_ENV === 'production',
  }
}
