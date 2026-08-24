import { NextResponse } from 'next/server'
import { getMcpConnectionConfig } from '../../../lib/config'
import { listMcpScopeValues } from '../../../lib/scope-registry'
import { ensureMcpScopesRegistered } from '../../../lib/bootstrap'

export const metadata = {
  GET: { requireAuth: false },
}

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 *
 * Served at the root well-known paths via a rewrite (see `next.config.ts`), which
 * is where MCP clients look after a 401 points them at `resource_metadata`. It
 * tells the client which authorization server to use for this resource.
 */
export async function GET(req: Request) {
  await ensureMcpScopesRegistered()
  const config = getMcpConnectionConfig(new URL(req.url).origin)

  return NextResponse.json(
    {
      resource: config.resourceUrl,
      authorization_servers: [config.issuer],
      scopes_supported: listMcpScopeValues(),
      bearer_methods_supported: ['header'],
      resource_documentation: `${config.publicUrl}/docs/mcp`,
    },
    {
      headers: {
        'cache-control': 'public, max-age=300',
        'content-type': 'application/json',
      },
    },
  )
}
