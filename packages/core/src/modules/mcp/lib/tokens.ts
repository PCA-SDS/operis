import crypto from 'node:crypto'
import { deriveJwtAudienceSecret, signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { MCP_TOKEN_KEY_AUDIENCE, MCP_TOKEN_USE, type McpConnectionConfig } from './config'

export type McpAccessTokenClaims = {
  iss: string
  aud: string
  sub: string
  exp: number
  iat: number
  jti: string
  token_use: typeof MCP_TOKEN_USE
  scope: string
  client_id: string
  tenant_id: string
  organization_id: string
}

export type McpAccessTokenPayload = {
  userId: string
  tenantId: string
  organizationId: string
  clientId: string
  scopes: string[]
  resource: string
}

/**
 * Signing key for MCP access tokens.
 *
 * Derived from `JWT_SECRET` under its own audience label, so an MCP token and a
 * staff session cookie are signed with *different* keys. That is what stops a
 * stolen session JWT being presented as a Bearer token here, and stops an MCP
 * token being replayed against the normal application API.
 */
function mcpSigningSecret(): string {
  return deriveJwtAudienceSecret(MCP_TOKEN_KEY_AUDIENCE)
}

export function issueMcpAccessToken(
  payload: McpAccessTokenPayload,
  config: McpConnectionConfig,
): { token: string; expiresIn: number; jti: string } {
  const jti = crypto.randomUUID()
  const token = signJwt(
    {
      sub: payload.userId,
      jti,
      token_use: MCP_TOKEN_USE,
      scope: payload.scopes.join(' '),
      client_id: payload.clientId,
      tenant_id: payload.tenantId,
      organization_id: payload.organizationId,
      // `aud` is set explicitly so it carries the RFC 8707 resource identifier
      // rather than the key-derivation label.
      aud: payload.resource,
    },
    {
      secret: mcpSigningSecret(),
      audience: payload.resource,
      issuer: config.issuer,
      expiresInSec: config.accessTokenTtlSeconds,
    },
  )
  return { token, expiresIn: config.accessTokenTtlSeconds, jti }
}

export type McpTokenVerificationFailure =
  | 'malformed'
  | 'invalid_signature_or_claims'
  | 'wrong_token_use'
  | 'incomplete_claims'

export type McpTokenVerificationResult =
  | { ok: true; claims: McpAccessTokenClaims }
  | { ok: false; reason: McpTokenVerificationFailure }

/**
 * Full cryptographic verification — signature, issuer, audience and expiry — never
 * a bare decode. Passing explicit options also bypasses `verifyJwt`'s legacy
 * raw-`JWT_SECRET` fallback, so a token signed with the base secret (or with the
 * staff key) can never authenticate here.
 */
export function verifyMcpAccessToken(
  token: string,
  config: McpConnectionConfig,
): McpTokenVerificationResult {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return { ok: false, reason: 'malformed' }
  }

  let payload: Record<string, unknown> | null
  try {
    payload = verifyJwt(token, {
      secret: mcpSigningSecret(),
      audience: config.resourceUrl,
      issuer: config.issuer,
    })
  } catch {
    return { ok: false, reason: 'invalid_signature_or_claims' }
  }

  if (!payload) return { ok: false, reason: 'invalid_signature_or_claims' }
  if (payload.token_use !== MCP_TOKEN_USE) return { ok: false, reason: 'wrong_token_use' }

  const sub = payload.sub
  const tenantId = payload.tenant_id
  const organizationId = payload.organization_id
  const clientId = payload.client_id
  const scope = payload.scope
  const jti = payload.jti

  if (
    typeof sub !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof organizationId !== 'string' ||
    typeof clientId !== 'string' ||
    typeof scope !== 'string' ||
    typeof jti !== 'string'
  ) {
    return { ok: false, reason: 'incomplete_claims' }
  }

  return {
    ok: true,
    claims: {
      iss: String(payload.iss),
      aud: String(payload.aud),
      sub,
      exp: Number(payload.exp),
      iat: Number(payload.iat),
      jti,
      token_use: MCP_TOKEN_USE,
      scope,
      client_id: clientId,
      tenant_id: tenantId,
      organization_id: organizationId,
    },
  }
}

/** Opaque high-entropy secret used for authorization codes and refresh tokens. */
export function generateOpaqueSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Codes and refresh tokens are stored hashed. SHA-256 (not bcrypt) because these
 * are full-entropy random secrets, not user-chosen passwords, and the token
 * endpoint must look them up by exact value.
 */
export function hashOpaqueSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex')
}
