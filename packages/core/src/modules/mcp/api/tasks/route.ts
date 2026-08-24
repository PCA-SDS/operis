import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  getMcpConnectionConfig,
  MCP_RESOURCE_PATH,
} from '../../lib/config'
import {
  authenticateMcpResourceRequest,
  extractBearerToken,
  type McpAuthFailureReason,
} from '../../lib/resource-auth'
import { createScopedMcpServer } from '../../lib/server'
import { buildWwwAuthenticate } from '../../lib/errors'
import { enforceMcpRateLimit, resolveClientIpForMcp } from '../../lib/rate-limit'
import { recordMcpAuthFailure } from '../../lib/audit'
import { ensureMcpScopesRegistered } from '../../lib/bootstrap'

const logger = createLogger('mcp').child({ component: 'endpoint' })

/**
 * `requireAuth: false` because this endpoint authenticates with an OAuth Bearer
 * token, not the application session — the dispatcher must not answer 401 before
 * we can emit the `WWW-Authenticate` challenge MCP clients need for discovery.
 * Every request is authenticated below; nothing here is public.
 */
export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
  DELETE: { requireAuth: false },
}

const MAX_REQUEST_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

function resourceMetadataUrl(origin: string): string {
  const config = getMcpConnectionConfig(origin)
  // RFC 9728 §3.1 — path-inserted well-known URI for a resource with a path.
  return `${config.publicUrl}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`
}

/**
 * Every authentication failure answers 401 with the same body and challenge.
 *
 * The distinction between "no token", "expired token", "user was deleted" and
 * "you are no longer in that organization" is recorded server-side but never
 * disclosed — otherwise the endpoint would confirm which users, tenants and
 * organizations exist.
 */
function unauthorized(origin: string, reason: McpAuthFailureReason): Response {
  const scopeHint = reason === 'no_effective_scopes' ? 'insufficient_scope' : 'invalid_token'
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    },
    {
      status: 401,
      headers: {
        'www-authenticate': buildWwwAuthenticate({
          resourceMetadataUrl: resourceMetadataUrl(origin),
          error: scopeHint,
        }),
        'cache-control': 'no-store',
      },
    },
  )
}

/**
 * Authenticate, then serve one MCP request.
 *
 * The transport runs **stateless**: no session id, JSON responses, one server
 * instance per request. That is deliberate for a Next.js route — there is no
 * durable per-connection memory to leak between users, and horizontal scaling
 * needs no sticky sessions. The OAuth token is the only session.
 */
async function handle(req: Request): Promise<Response> {
  await ensureMcpScopesRegistered()

  const origin = new URL(req.url).origin
  const correlationId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  const ipLimited = await enforceMcpRateLimit('ip', await resolveClientIpForMcp(req))
  if (ipLimited) return ipLimited

  const token = extractBearerToken(req.headers)
  if (!token) {
    recordMcpAuthFailure({ reason: 'missing_token', correlationId })
    return unauthorized(origin, 'missing_token')
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32600, message: 'Request too large' }, id: null },
      { status: 413 },
    )
  }

  const container = await createRequestContainer()
  const config = getMcpConnectionConfig(origin)

  const authResult = await authenticateMcpResourceRequest(token, container, config)
  if (!authResult.ok) {
    recordMcpAuthFailure({ reason: authResult.reason, correlationId })
    return unauthorized(origin, authResult.reason)
  }

  const context = authResult.context

  const sessionLimited = await enforceMcpRateLimit('session', context.tokenId)
  if (sessionLimited) return sessionLimited

  let parsedBody: unknown
  if (req.method === 'POST') {
    const raw = await req.text()
    if (raw.length > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32600, message: 'Request too large' }, id: null },
        { status: 413 },
      )
    }
    try {
      parsedBody = raw.length > 0 ? JSON.parse(raw) : undefined
    } catch {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
        { status: 400 },
      )
    }
  }

  const server = await createScopedMcpServer({ container, context })
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: the OAuth token is the session, so no server-side session id.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)

    const timeout = new Promise<Response>((_resolve, reject) => {
      setTimeout(() => reject(new Error('[internal] MCP request timed out')), REQUEST_TIMEOUT_MS)
    })

    const response = await Promise.race([
      transport.handleRequest(req, parsedBody !== undefined ? { parsedBody } : undefined),
      timeout,
    ])

    return response
  } catch (error) {
    logger.error('MCP request failed', { err: error, correlationId })
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
      { status: 500 },
    )
  } finally {
    await server.close().catch(() => undefined)
  }
}

export async function POST(req: Request) {
  return handle(req)
}

export async function GET(req: Request) {
  return handle(req)
}

export async function DELETE(req: Request) {
  return handle(req)
}
