import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { McpOAuthAuthorizationCode, McpOAuthRefreshToken } from '../data/entities'
import { generateOpaqueSecret, hashOpaqueSecret } from './tokens'
import type { McpConnectionConfig } from './config'

const logger = createLogger('mcp').child({ component: 'oauth-grants' })

export type IssuedAuthorizationCode = { code: string; expiresAt: Date }

export type AuthorizationGrantContext = {
  clientId: string
  userId: string
  tenantId: string
  organizationId: string
  scopes: string[]
  redirectUri: string
  codeChallenge: string
  resource: string
}

export async function issueAuthorizationCode(
  em: EntityManager,
  grant: AuthorizationGrantContext,
  config: McpConnectionConfig,
): Promise<IssuedAuthorizationCode> {
  const code = generateOpaqueSecret()
  const expiresAt = new Date(Date.now() + config.authorizationCodeTtlSeconds * 1000)

  const record = em.create(McpOAuthAuthorizationCode, {
    codeHash: hashOpaqueSecret(code),
    clientId: grant.clientId,
    userId: grant.userId,
    tenantId: grant.tenantId,
    organizationId: grant.organizationId,
    scopes: grant.scopes,
    redirectUri: grant.redirectUri,
    codeChallenge: grant.codeChallenge,
    codeChallengeMethod: 'S256' as const,
    resource: grant.resource,
    expiresAt,
    consumedAt: null,
    createdAt: new Date(),
  })

  em.persist(record)
  await em.flush()
  return { code, expiresAt }
}

export type ConsumeCodeResult =
  | { ok: true; record: McpOAuthAuthorizationCode }
  | { ok: false; reason: 'unknown' | 'expired' | 'replayed' }

/**
 * Atomically claim an authorization code.
 *
 * The claim is a conditional UPDATE (`consumed_at is null`) rather than a
 * read-then-write, so two concurrent token requests carrying the same code
 * cannot both succeed. A code presented twice is treated as theft: OAuth 2.1
 * requires revoking every token already derived from it.
 */
export async function consumeAuthorizationCode(
  em: EntityManager,
  code: string,
): Promise<ConsumeCodeResult> {
  const codeHash = hashOpaqueSecret(code)
  const now = new Date()

  const claimed = await em.nativeUpdate(
    McpOAuthAuthorizationCode,
    { codeHash, consumedAt: null },
    { consumedAt: now },
  )

  const record = await em.findOne(McpOAuthAuthorizationCode, { codeHash })
  if (!record) return { ok: false, reason: 'unknown' }

  if (claimed === 0) {
    // Already consumed — the code leaked. Kill the whole grant.
    logger.warn('Authorization code replay detected; revoking derived tokens', {
      clientId: record.clientId,
      userId: record.userId,
    })
    await revokeTokensForAuthorizationCode(em, record)
    return { ok: false, reason: 'replayed' }
  }

  if (record.expiresAt.getTime() < now.getTime()) return { ok: false, reason: 'expired' }

  return { ok: true, record }
}

async function revokeTokensForAuthorizationCode(
  em: EntityManager,
  record: McpOAuthAuthorizationCode,
): Promise<void> {
  await em.nativeUpdate(
    McpOAuthRefreshToken,
    { clientId: record.clientId, userId: record.userId, revokedAt: null },
    { revokedAt: new Date() },
  )
}

export type IssuedRefreshToken = { token: string; grantId: string; expiresAt: Date }

export async function issueRefreshToken(
  em: EntityManager,
  grant: {
    grantId?: string
    clientId: string
    userId: string
    tenantId: string
    organizationId: string
    scopes: string[]
    resource: string
  },
  config: McpConnectionConfig,
): Promise<IssuedRefreshToken> {
  const token = generateOpaqueSecret()
  const grantId = grant.grantId ?? crypto.randomUUID()
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlSeconds * 1000)

  const record = em.create(McpOAuthRefreshToken, {
    tokenHash: hashOpaqueSecret(token),
    grantId,
    clientId: grant.clientId,
    userId: grant.userId,
    tenantId: grant.tenantId,
    organizationId: grant.organizationId,
    scopes: grant.scopes,
    resource: grant.resource,
    expiresAt,
    rotatedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  })

  em.persist(record)
  await em.flush()
  return { token, grantId, expiresAt }
}

export type RedeemRefreshResult =
  | { ok: true; record: McpOAuthRefreshToken }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' }

/**
 * Redeem and rotate a refresh token.
 *
 * Same conditional-UPDATE claim as authorization codes. Presenting a token that
 * was already rotated means the token was captured, so the entire grant chain is
 * revoked rather than just refusing this one request.
 */
export async function redeemRefreshToken(
  em: EntityManager,
  token: string,
): Promise<RedeemRefreshResult> {
  const tokenHash = hashOpaqueSecret(token)
  const now = new Date()

  const claimed = await em.nativeUpdate(
    McpOAuthRefreshToken,
    { tokenHash, rotatedAt: null, revokedAt: null },
    { rotatedAt: now },
  )

  const record = await em.findOne(McpOAuthRefreshToken, { tokenHash })
  if (!record) return { ok: false, reason: 'unknown' }

  if (claimed === 0) {
    if (record.revokedAt) return { ok: false, reason: 'revoked' }
    logger.warn('Refresh token reuse detected; revoking grant chain', {
      grantId: record.grantId,
      clientId: record.clientId,
    })
    await revokeGrantChain(em, record.grantId)
    return { ok: false, reason: 'reused' }
  }

  if (record.expiresAt.getTime() < now.getTime()) return { ok: false, reason: 'expired' }

  return { ok: true, record }
}

export async function revokeGrantChain(em: EntityManager, grantId: string): Promise<void> {
  await em.nativeUpdate(McpOAuthRefreshToken, { grantId, revokedAt: null }, { revokedAt: new Date() })
}

/** Housekeeping for expired codes; safe to call opportunistically. */
export async function purgeExpiredAuthorizationCodes(em: EntityManager): Promise<void> {
  await em.nativeDelete(McpOAuthAuthorizationCode, { expiresAt: { $lt: new Date() } })
}
