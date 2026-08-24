import { NextResponse } from 'next/server'
import {
  getMcpConnectionConfig,
  MCP_REGISTER_PATH,
} from '../../../lib/config'
import { listMcpScopeValues } from '../../../lib/scope-registry'
import { SUPPORTED_CODE_CHALLENGE_METHODS } from '../../../lib/pkce'
import { ensureMcpScopesRegistered } from '../../../lib/bootstrap'

export const metadata = {
  GET: { requireAuth: false },
}

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 *
 * The advertised capabilities are deliberately narrow and match what the token
 * endpoint actually implements: authorization code + refresh only (no implicit,
 * no password, no client credentials), and S256 PKCE only.
 */
export async function GET(req: Request) {
  await ensureMcpScopesRegistered()
  const config = getMcpConnectionConfig(new URL(req.url).origin)

  const document: Record<string, unknown> = {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    scopes_supported: listMcpScopeValues(),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: [...SUPPORTED_CODE_CHALLENGE_METHODS],
    // RFC 8707 — the client must name the resource it wants a token for, and the
    // issued token's audience is bound to it.
    authorization_response_iss_parameter_supported: true,
    resource_indicators_supported: true,
    client_id_metadata_document_supported: config.clientIdMetadataDocumentsEnabled,
    service_documentation: `${config.publicUrl}/docs/mcp`,
  }

  if (config.dynamicRegistrationEnabled) {
    document.registration_endpoint = `${config.publicUrl}${MCP_REGISTER_PATH}`
  }

  return NextResponse.json(document, {
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json',
    },
  })
}
