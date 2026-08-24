import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getMcpConnectionConfig } from '../../../lib/config'
import { resolveMcpClient, redirectUriMatches, verifyClientSecret } from '../../../lib/clients'
import { verifyCodeVerifier } from '../../../lib/pkce'
import {
  consumeAuthorizationCode,
  issueRefreshToken,
  redeemRefreshToken,
  revokeGrantChain,
} from '../../../lib/grants'
import { issueMcpAccessToken } from '../../../lib/tokens'
import { filterKnownScopes } from '../../../lib/scope-registry'
import { enforceMcpRateLimit, resolveClientIpForMcp } from '../../../lib/rate-limit'
import { oauthErrorResponse } from '../../../lib/errors'
import { ensureMcpScopesRegistered } from '../../../lib/bootstrap'

const logger = createLogger('mcp').child({ component: 'token' })

export const metadata = {
  POST: { requireAuth: false },
}

const MAX_BODY_BYTES = 16 * 1024

const authorizationCodeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1).max(512),
  redirect_uri: z.string().min(1).max(2048),
  client_id: z.string().min(1).max(2048),
  code_verifier: z.string().min(43).max(128),
  resource: z.string().max(2048).optional(),
})

const refreshTokenGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1).max(512),
  client_id: z.string().min(1).max(2048),
  scope: z.string().max(512).optional(),
  resource: z.string().max(2048).optional(),
})

/**
 * Client credentials may arrive in the body or as HTTP Basic (RFC 6749 §2.3.1).
 * A public client sends neither, and `verifyClientSecret` requires that absence.
 */
function extractClientSecret(req: Request, form: URLSearchParams): string | null {
  const header = req.headers.get('authorization')
  if (header && header.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
      const separator = decoded.indexOf(':')
      if (separator > 0) return decodeURIComponent(decoded.slice(separator + 1))
    } catch {
      return null
    }
  }
  const bodySecret = form.get('client_secret')
  return bodySecret && bodySecret.length > 0 ? bodySecret : null
}

function clientIdFromBasicAuth(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header || !header.toLowerCase().startsWith('basic ')) return null
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    return separator > 0 ? decodeURIComponent(decoded.slice(0, separator)) : null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  await ensureMcpScopesRegistered()

  const rateLimited = await enforceMcpRateLimit('auth', await resolveClientIpForMcp(req))
  if (rateLimited) return rateLimited

  const config = getMcpConnectionConfig(new URL(req.url).origin)

  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) return oauthErrorResponse('invalid_request')

  const form = new URLSearchParams(rawBody)
  const fields = Object.fromEntries(form.entries())

  // A client id in Basic auth must agree with the body when both are present.
  const basicClientId = clientIdFromBasicAuth(req)
  if (basicClientId) {
    if (fields.client_id && fields.client_id !== basicClientId) {
      return oauthErrorResponse('invalid_client')
    }
    fields.client_id = basicClientId
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  if (fields.grant_type === 'authorization_code') {
    return handleAuthorizationCodeGrant(req, em, form, fields, config)
  }
  if (fields.grant_type === 'refresh_token') {
    return handleRefreshTokenGrant(req, em, form, fields, config)
  }
  return oauthErrorResponse('unsupported_grant_type')
}

type Config = ReturnType<typeof getMcpConnectionConfig>

async function handleAuthorizationCodeGrant(
  req: Request,
  em: EntityManager,
  form: URLSearchParams,
  fields: Record<string, string>,
  config: Config,
): Promise<Response> {
  const parsed = authorizationCodeGrantSchema.safeParse(fields)
  if (!parsed.success) return oauthErrorResponse('invalid_request')
  const params = parsed.data

  const client = await resolveMcpClient(em, params.client_id, config)
  if (!client) return oauthErrorResponse('invalid_client')

  const secretOk = await verifyClientSecret(client, extractClientSecret(req, form))
  if (!secretOk) return oauthErrorResponse('invalid_client')

  // Claiming the code is atomic and single-use; a replay revokes the grant.
  const consumed = await consumeAuthorizationCode(em, params.code)
  if (!consumed.ok) return oauthErrorResponse('invalid_grant')
  const record = consumed.record

  // Every binding on the code is re-checked: the code belongs to this client,
  // was issued for this redirect URI, and for this resource.
  if (record.clientId !== params.client_id) return oauthErrorResponse('invalid_grant')
  if (!redirectUriMatches(record.redirectUri, params.redirect_uri)) {
    return oauthErrorResponse('invalid_grant')
  }
  if (params.resource && params.resource.replace(/\/+$/, '') !== record.resource) {
    return oauthErrorResponse('invalid_target')
  }

  if (!verifyCodeVerifier(params.code_verifier, record.codeChallenge)) {
    return oauthErrorResponse('invalid_grant')
  }

  const scopes = filterKnownScopes(record.scopes)
  if (scopes.length === 0) return oauthErrorResponse('invalid_scope')

  const accessToken = issueMcpAccessToken(
    {
      userId: record.userId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      clientId: record.clientId,
      scopes,
      resource: record.resource,
    },
    config,
  )

  const refresh = await issueRefreshToken(
    em,
    {
      clientId: record.clientId,
      userId: record.userId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      scopes,
      resource: record.resource,
    },
    config,
  )

  logger.info('MCP access token issued', {
    clientId: record.clientId,
    grantType: 'authorization_code',
    scopes,
  })

  return tokenResponse(accessToken.token, accessToken.expiresIn, refresh.token, scopes)
}

async function handleRefreshTokenGrant(
  req: Request,
  em: EntityManager,
  form: URLSearchParams,
  fields: Record<string, string>,
  config: Config,
): Promise<Response> {
  const parsed = refreshTokenGrantSchema.safeParse(fields)
  if (!parsed.success) return oauthErrorResponse('invalid_request')
  const params = parsed.data

  const client = await resolveMcpClient(em, params.client_id, config)
  if (!client) return oauthErrorResponse('invalid_client')

  const secretOk = await verifyClientSecret(client, extractClientSecret(req, form))
  if (!secretOk) return oauthErrorResponse('invalid_client')

  const redeemed = await redeemRefreshToken(em, params.refresh_token)
  if (!redeemed.ok) return oauthErrorResponse('invalid_grant')
  const record = redeemed.record

  if (record.clientId !== params.client_id) {
    // The token is real but belongs to another client — treat as theft.
    await revokeGrantChain(em, record.grantId)
    return oauthErrorResponse('invalid_grant')
  }

  if (params.resource && params.resource.replace(/\/+$/, '') !== record.resource) {
    return oauthErrorResponse('invalid_grant')
  }

  // A refresh may narrow the scope set but never widen it (RFC 6749 §6).
  let scopes = filterKnownScopes(record.scopes)
  if (params.scope) {
    const requested = params.scope.split(/\s+/).filter(Boolean)
    if (!requested.every((scope) => scopes.includes(scope))) {
      return oauthErrorResponse('invalid_scope')
    }
    scopes = filterKnownScopes(requested)
  }
  if (scopes.length === 0) return oauthErrorResponse('invalid_scope')

  const accessToken = issueMcpAccessToken(
    {
      userId: record.userId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      clientId: record.clientId,
      scopes,
      resource: record.resource,
    },
    config,
  )

  // Rotation: the redeemed token is already marked rotated, and its successor
  // stays on the same grant chain so a later reuse revokes both.
  const refresh = await issueRefreshToken(
    em,
    {
      grantId: record.grantId,
      clientId: record.clientId,
      userId: record.userId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      scopes,
      resource: record.resource,
    },
    config,
  )

  return tokenResponse(accessToken.token, accessToken.expiresIn, refresh.token, scopes)
}

function tokenResponse(
  accessToken: string,
  expiresIn: number,
  refreshToken: string,
  scopes: string[],
): Response {
  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    },
    {
      // Tokens must never be cached by an intermediary.
      headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
    },
  )
}
