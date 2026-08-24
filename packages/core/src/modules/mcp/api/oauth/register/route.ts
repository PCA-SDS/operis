import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { getMcpConnectionConfig } from '../../../lib/config'
import { McpOAuthClient } from '../../../data/entities'
import {
  generateClientSecret,
  hashClientSecret,
  isAcceptableRedirectUri,
} from '../../../lib/clients'
import { filterKnownScopes, listMcpScopeValues } from '../../../lib/scope-registry'
import { enforceMcpRateLimit, resolveClientIpForMcp } from '../../../lib/rate-limit'
import { oauthErrorResponse } from '../../../lib/errors'
import { ensureMcpScopesRegistered } from '../../../lib/bootstrap'

const logger = createLogger('mcp').child({ component: 'register' })

export const metadata = {
  POST: { requireAuth: false },
}

const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string().min(1).max(2048)).min(1).max(10),
  scope: z.string().max(512).optional(),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional(),
  grant_types: z.array(z.string().max(64)).max(10).optional(),
})

/**
 * RFC 7591 Dynamic Client Registration — a compatibility fallback only.
 *
 * The current MCP authorization specification prefers pre-registered clients, and
 * Client ID Metadata Documents where a dynamic client is genuinely needed. Open
 * registration lets anyone create a client on this authorization server, so it
 * stays **off** unless `MCP_OAUTH_DYNAMIC_REGISTRATION` is explicitly enabled;
 * when disabled the endpoint is not advertised in metadata and answers 404.
 */
export async function POST(req: Request) {
  await ensureMcpScopesRegistered()

  const config = getMcpConnectionConfig(new URL(req.url).origin)
  if (!config.dynamicRegistrationEnabled) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const rateLimited = await enforceMcpRateLimit('auth', await resolveClientIpForMcp(req))
  if (rateLimited) return rateLimited

  const parsed = registrationSchema.safeParse(await readJsonSafe<Record<string, unknown>>(req, {}))
  if (!parsed.success) return oauthErrorResponse('invalid_request')
  const body = parsed.data

  const redirectUris = body.redirect_uris.filter((uri) =>
    isAcceptableRedirectUri(uri, config.requireHttps),
  )
  if (redirectUris.length !== body.redirect_uris.length) {
    return oauthErrorResponse('invalid_request')
  }

  const requestedScopes = body.scope ? body.scope.split(/\s+/).filter(Boolean) : listMcpScopeValues()
  const allowedScopes = filterKnownScopes(requestedScopes)
  if (allowedScopes.length === 0) return oauthErrorResponse('invalid_scope')

  const isPublic = (body.token_endpoint_auth_method ?? 'none') === 'none'
  const clientId = `mcp_${crypto.randomUUID().replace(/-/g, '')}`
  const clientSecret = isPublic ? null : generateClientSecret()

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const record = em.create(McpOAuthClient, {
    clientId,
    clientName: body.client_name,
    clientSecretHash: clientSecret ? await hashClientSecret(clientSecret) : null,
    redirectUris,
    allowedScopes,
    registrationSource: 'dynamic' as const,
    tenantId: null,
    isActive: true,
    createdAt: new Date(),
  })
  em.persist(record)
  await em.flush()

  // The secret is returned exactly once and never logged.
  logger.info('MCP dynamic client registered', { clientId, isPublic, scopes: allowedScopes })

  return NextResponse.json(
    {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_name: body.client_name,
      redirect_uris: redirectUris,
      scope: allowedScopes.join(' '),
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_post',
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  )
}
