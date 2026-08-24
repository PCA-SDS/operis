import { NextResponse } from 'next/server'

/**
 * RFC 6749 §5.2 / RFC 9728 error codes.
 *
 * Every message here is deliberately coarse. OAuth error responses are returned
 * to an unauthenticated caller, so they must never disclose whether a client id
 * exists, whether a code was already consumed, or which specific claim failed —
 * that turns the endpoint into an enumeration oracle.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'server_error'
  | 'invalid_token'
  | 'insufficient_scope'
  | 'invalid_target'

const SAFE_DESCRIPTIONS: Record<OAuthErrorCode, string> = {
  invalid_request: 'The request is missing a required parameter or is otherwise malformed.',
  invalid_client: 'Client authentication failed.',
  invalid_grant: 'The provided authorization grant is invalid, expired or revoked.',
  unauthorized_client: 'The client is not authorized to use this grant type.',
  unsupported_grant_type: 'The requested grant type is not supported.',
  invalid_scope: 'The requested scope is invalid or unknown.',
  access_denied: 'The request was denied.',
  server_error: 'The authorization server encountered an unexpected condition.',
  invalid_token: 'The access token is missing, expired or invalid.',
  insufficient_scope: 'The access token does not grant the required scope.',
  invalid_target: 'The requested resource is not served by this authorization server.',
}

const STATUS_BY_CODE: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 400,
  unsupported_grant_type: 400,
  invalid_scope: 400,
  access_denied: 403,
  server_error: 500,
  invalid_token: 401,
  insufficient_scope: 403,
  invalid_target: 400,
}

export function oauthErrorResponse(
  code: OAuthErrorCode,
  options: { headers?: Record<string, string>; status?: number } = {},
): Response {
  return NextResponse.json(
    { error: code, error_description: SAFE_DESCRIPTIONS[code] },
    {
      status: options.status ?? STATUS_BY_CODE[code],
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache',
        ...(options.headers ?? {}),
      },
    },
  )
}

/**
 * RFC 9728 §5.1 — the challenge that tells an MCP client where to authenticate.
 * `resource_metadata` is what makes discovery work from a bare 401.
 */
export function buildWwwAuthenticate(options: {
  resourceMetadataUrl: string
  error?: 'invalid_token' | 'insufficient_scope'
  scope?: string
}): string {
  const parts = [`Bearer resource_metadata="${options.resourceMetadataUrl}"`]
  if (options.error) {
    parts.push(`error="${options.error}"`)
    parts.push(`error_description="${SAFE_DESCRIPTIONS[options.error]}"`)
  }
  if (options.scope) parts.push(`scope="${options.scope}"`)
  return parts.join(', ')
}
