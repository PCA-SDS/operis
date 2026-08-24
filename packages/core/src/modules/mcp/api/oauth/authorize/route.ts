import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getMcpConnectionConfig,
  MCP_AUTHORIZE_PATH,
  MCP_CONSENT_PATH,
} from '../../../lib/config'
import { isValidCodeChallenge, SUPPORTED_CODE_CHALLENGE_METHODS } from '../../../lib/pkce'
import { redirectUriMatches, resolveMcpClient } from '../../../lib/clients'
import { filterKnownScopes } from '../../../lib/scope-registry'
import { issueAuthorizationCode, purgeExpiredAuthorizationCodes } from '../../../lib/grants'
import {
  assertOrganizationSelectable,
  signAuthorizationRequest,
  verifyAuthorizationRequest,
} from '../../../lib/consent'
import { enforceMcpRateLimit, resolveClientIpForMcp } from '../../../lib/rate-limit'
import { oauthErrorResponse } from '../../../lib/errors'
import { ensureMcpScopesRegistered } from '../../../lib/bootstrap'

const logger = createLogger('mcp').child({ component: 'authorize' })

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

const authorizeQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(2048),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().min(1).max(256),
  code_challenge_method: z.enum(SUPPORTED_CODE_CHALLENGE_METHODS),
  scope: z.string().max(512).optional(),
  state: z.string().max(512).optional(),
  resource: z.string().max(2048).optional(),
})

const decisionSchema = z.object({
  request: z.string().min(1).max(8192),
  organizationId: z.string().uuid(),
  decision: z.enum(['approve', 'deny']),
})

/**
 * Redirect an OAuth error back to the client (RFC 6749 §4.1.2.1).
 *
 * Only ever used once the redirect URI has been proven to belong to the client —
 * before that point an error must be shown to the user instead, or we would
 * become an open redirector for anyone who can guess a client id.
 */
function redirectWithError(
  redirectUri: string,
  error: string,
  state: string | null,
  issuer: string,
): Response {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (state) url.searchParams.set('state', state)
  url.searchParams.set('iss', issuer)
  return NextResponse.redirect(url.toString(), { status: 302 })
}

/**
 * GET — validate the authorization request, require a signed-in staff session,
 * then hand off to the consent screen.
 *
 * Nothing is persisted here. The validated request travels to the consent screen
 * as a signed ticket, so the decision endpoint cannot be fed different parameters
 * than the ones checked here.
 */
export async function GET(req: Request) {
  await ensureMcpScopesRegistered()

  const rateLimited = await enforceMcpRateLimit('auth', await resolveClientIpForMcp(req))
  if (rateLimited) return rateLimited

  const url = new URL(req.url)
  const config = getMcpConnectionConfig(url.origin)
  const parsed = authorizeQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))

  if (!parsed.success) {
    // No validated redirect URI yet — answer the user, never the client.
    return oauthErrorResponse('invalid_request')
  }

  const params = parsed.data

  if (!isValidCodeChallenge(params.code_challenge)) {
    return oauthErrorResponse('invalid_request')
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const client = await resolveMcpClient(em, params.client_id, config)
  if (!client) return oauthErrorResponse('invalid_client')

  // Exact redirect URI match against the client's registration. Until this
  // passes, no redirect of any kind may be emitted.
  const registeredRedirect = client.redirectUris.find((candidate) =>
    redirectUriMatches(candidate, params.redirect_uri),
  )
  if (!registeredRedirect) return oauthErrorResponse('invalid_request')

  const state = params.state ?? null

  // RFC 8707: when the client names a resource it must be the one we protect.
  if (params.resource && params.resource.replace(/\/+$/, '') !== config.resourceUrl) {
    return redirectWithError(params.redirect_uri, 'invalid_target', state, config.issuer)
  }

  const requestedScopes = params.scope ? params.scope.split(/\s+/).filter(Boolean) : []
  const knownScopes = filterKnownScopes(requestedScopes)
  const grantableScopes = knownScopes.filter((scope) => client.allowedScopes.includes(scope))

  if (requestedScopes.length > 0 && grantableScopes.length !== requestedScopes.length) {
    return redirectWithError(params.redirect_uri, 'invalid_scope', state, config.issuer)
  }

  const effectiveScopes = grantableScopes.length > 0 ? grantableScopes : client.allowedScopes
  if (effectiveScopes.length === 0) {
    return redirectWithError(params.redirect_uri, 'invalid_scope', state, config.issuer)
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    // Reuse the application's own login; MCP introduces no second credential
    // store. `redirect` brings the user back to this exact request afterwards.
    const returnTo = `${MCP_AUTHORIZE_PATH}${url.search}`
    const loginUrl = new URL('/login', config.publicUrl)
    loginUrl.searchParams.set('redirect', returnTo)
    return NextResponse.redirect(loginUrl.toString(), { status: 302 })
  }

  const ticket = signAuthorizationRequest({
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUri: params.redirect_uri,
    scopes: effectiveScopes,
    state,
    codeChallenge: params.code_challenge,
    resource: config.resourceUrl,
    userId: auth.sub,
    tenantId: auth.tenantId,
  })

  const consentUrl = new URL(MCP_CONSENT_PATH, config.publicUrl)
  consentUrl.searchParams.set('request', ticket)
  return NextResponse.redirect(consentUrl.toString(), { status: 302 })
}

/**
 * POST — record the user's decision and mint the authorization code.
 *
 * The signed ticket supplies the client, redirect URI, scopes and PKCE challenge.
 * The session supplies the user. Only the organization comes from the form, and
 * it is re-validated against live membership before anything is issued.
 */
export async function POST(req: Request) {
  await ensureMcpScopesRegistered()

  const rateLimited = await enforceMcpRateLimit('auth', await resolveClientIpForMcp(req))
  if (rateLimited) return rateLimited

  const config = getMcpConnectionConfig(new URL(req.url).origin)
  const body = decisionSchema.safeParse(await readJsonSafe<Record<string, unknown>>(req, {}))
  if (!body.success) return oauthErrorResponse('invalid_request')

  const ticket = verifyAuthorizationRequest(body.data.request)
  if (!ticket) return oauthErrorResponse('invalid_request')

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return oauthErrorResponse('access_denied', { status: 401 })

  // The ticket is bound to the user who passed through GET. A different session
  // presenting it — a stolen link, a shared browser — is refused.
  if (auth.sub !== ticket.userId || auth.tenantId !== ticket.tenantId) {
    return oauthErrorResponse('access_denied')
  }

  if (body.data.decision === 'deny') {
    return NextResponse.json({
      redirectTo: buildRedirect(ticket.redirectUri, {
        error: 'access_denied',
        state: ticket.state,
        iss: config.issuer,
      }),
    })
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const selectable = await assertOrganizationSelectable(
    container,
    auth.sub,
    auth.tenantId,
    body.data.organizationId,
  )
  if (!selectable) return oauthErrorResponse('access_denied')

  // The client could have been deactivated while the user was deciding.
  const client = await resolveMcpClient(em, ticket.clientId, config)
  if (!client || !client.redirectUris.some((uri) => redirectUriMatches(uri, ticket.redirectUri))) {
    return oauthErrorResponse('invalid_client')
  }

  const scopes = filterKnownScopes(ticket.scopes).filter((scope) =>
    client.allowedScopes.includes(scope),
  )
  if (scopes.length === 0) return oauthErrorResponse('invalid_scope')

  const { code } = await issueAuthorizationCode(
    em,
    {
      clientId: ticket.clientId,
      userId: auth.sub,
      tenantId: auth.tenantId,
      organizationId: body.data.organizationId,
      scopes,
      redirectUri: ticket.redirectUri,
      codeChallenge: ticket.codeChallenge,
      resource: config.resourceUrl,
    },
    config,
  )

  void purgeExpiredAuthorizationCodes(em).catch(() => undefined)

  logger.info('MCP authorization granted', {
    clientId: ticket.clientId,
    scopes,
    userId: auth.sub,
    tenantId: auth.tenantId,
    organizationId: body.data.organizationId,
  })

  return NextResponse.json(
    {
      redirectTo: buildRedirect(ticket.redirectUri, {
        code,
        state: ticket.state,
        iss: config.issuer,
      }),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

function buildRedirect(
  redirectUri: string,
  params: { code?: string; error?: string; state: string | null; iss: string },
): string {
  const url = new URL(redirectUri)
  if (params.code) url.searchParams.set('code', params.code)
  if (params.error) url.searchParams.set('error', params.error)
  if (params.state) url.searchParams.set('state', params.state)
  url.searchParams.set('iss', params.iss)
  return url.toString()
}
