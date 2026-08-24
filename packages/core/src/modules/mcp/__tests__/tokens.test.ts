/**
 * Access-token verification. Every case here is a way a token could be forged or
 * misdirected; all of them must fail closed.
 */
import { signJwt, deriveJwtAudienceSecret, signAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { getMcpConnectionConfig, MCP_TOKEN_KEY_AUDIENCE, MCP_TOKEN_USE } from '../lib/config'
import { issueMcpAccessToken, verifyMcpAccessToken, hashOpaqueSecret, generateOpaqueSecret } from '../lib/tokens'

const ORIGINAL_ENV = { ...process.env }

function configure(overrides: Record<string, string | undefined> = {}) {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-policy-0123456789'
  process.env.MCP_PUBLIC_URL = 'https://erp.example.com'
  process.env.NODE_ENV = 'test'
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return getMcpConnectionConfig()
}

const payload = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  clientId: 'mcp_client',
  scopes: ['tasks:read'],
  resource: 'https://erp.example.com/api/mcp/tasks',
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('MCP access tokens', () => {
  it('round-trips a valid token with every binding claim intact', () => {
    const config = configure()
    const { token, jti } = issueMcpAccessToken(payload, config)

    const result = verifyMcpAccessToken(token, config)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.claims.sub).toBe(payload.userId)
    expect(result.claims.tenant_id).toBe(payload.tenantId)
    expect(result.claims.organization_id).toBe(payload.organizationId)
    expect(result.claims.client_id).toBe(payload.clientId)
    expect(result.claims.scope).toBe('tasks:read')
    expect(result.claims.token_use).toBe(MCP_TOKEN_USE)
    expect(result.claims.aud).toBe(payload.resource)
    expect(result.claims.jti).toBe(jti)
  })

  it('rejects a malformed token', () => {
    const config = configure()
    expect(verifyMcpAccessToken('not-a-jwt', config)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyMcpAccessToken('', config)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects a token signed with the wrong key', () => {
    const config = configure()
    const forged = signJwt(
      { sub: payload.userId, token_use: MCP_TOKEN_USE, aud: payload.resource },
      { secret: 'a-different-secret-of-sufficient-length-0123456789', audience: payload.resource, issuer: config.issuer },
    )
    expect(verifyMcpAccessToken(forged, config)).toEqual({
      ok: false,
      reason: 'invalid_signature_or_claims',
    })
  })

  it('rejects a token minted by a different issuer', () => {
    const config = configure()
    const otherIssuer = signJwt(
      { sub: payload.userId, token_use: MCP_TOKEN_USE, aud: payload.resource },
      {
        secret: deriveJwtAudienceSecret(MCP_TOKEN_KEY_AUDIENCE),
        audience: payload.resource,
        issuer: 'https://evil.example.com',
      },
    )
    expect(verifyMcpAccessToken(otherIssuer, config).ok).toBe(false)
  })

  it('rejects a token issued for a different resource (audience binding)', () => {
    const config = configure()
    const otherResource = issueMcpAccessToken(
      { ...payload, resource: 'https://erp.example.com/api/mcp/other' },
      config,
    )
    expect(verifyMcpAccessToken(otherResource.token, config).ok).toBe(false)
  })

  it('rejects an expired token', () => {
    const config = configure({ MCP_ACCESS_TOKEN_TTL_SECONDS: '60' })
    const expired = signJwt(
      {
        sub: payload.userId,
        token_use: MCP_TOKEN_USE,
        aud: payload.resource,
        jti: 'x',
        scope: 'tasks:read',
        client_id: 'c',
        tenant_id: payload.tenantId,
        organization_id: payload.organizationId,
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      {
        secret: deriveJwtAudienceSecret(MCP_TOKEN_KEY_AUDIENCE),
        audience: payload.resource,
        issuer: config.issuer,
      },
    )
    expect(verifyMcpAccessToken(expired, config).ok).toBe(false)
  })

  it('rejects a token that is not marked as an MCP access token', () => {
    const config = configure()
    const wrongUse = signJwt(
      {
        sub: payload.userId,
        token_use: 'something_else',
        aud: payload.resource,
        jti: 'x',
        scope: 'tasks:read',
        client_id: 'c',
        tenant_id: payload.tenantId,
        organization_id: payload.organizationId,
      },
      {
        secret: deriveJwtAudienceSecret(MCP_TOKEN_KEY_AUDIENCE),
        audience: payload.resource,
        issuer: config.issuer,
      },
    )
    expect(verifyMcpAccessToken(wrongUse, config)).toEqual({ ok: false, reason: 'wrong_token_use' })
  })

  it('rejects a token missing the tenant/organization binding claims', () => {
    const config = configure()
    const incomplete = signJwt(
      { sub: payload.userId, token_use: MCP_TOKEN_USE, aud: payload.resource, jti: 'x', scope: 'tasks:read', client_id: 'c' },
      {
        secret: deriveJwtAudienceSecret(MCP_TOKEN_KEY_AUDIENCE),
        audience: payload.resource,
        issuer: config.issuer,
      },
    )
    expect(verifyMcpAccessToken(incomplete, config)).toEqual({ ok: false, reason: 'incomplete_claims' })
  })

  it('refuses a staff session JWT presented as an MCP bearer token', () => {
    // The signing keys are derived per audience, so a valid staff cookie token
    // must not verify here even though both come from the same JWT_SECRET.
    const config = configure()
    const staffToken = signAudienceJwt('staff', {
      sub: payload.userId,
      tenant_id: payload.tenantId,
      organization_id: payload.organizationId,
      token_use: MCP_TOKEN_USE,
      scope: 'tasks:read tasks:write',
      client_id: 'c',
      jti: 'x',
    })
    expect(verifyMcpAccessToken(staffToken, config).ok).toBe(false)
  })

  it('ignores the legacy raw-JWT_SECRET fallback', () => {
    // verifyJwt has a migration fallback for tokens signed with the bare secret.
    // MCP passes explicit options so that path can never be reached.
    const config = configure({ JWT_LEGACY_GRACE_MINUTES: '480', JWT_LEGACY_CUTOVER_AT: '2099-01-01T00:00:00Z' })
    const legacy = signJwt(
      { sub: payload.userId, token_use: MCP_TOKEN_USE, aud: payload.resource },
      process.env.JWT_SECRET as string,
    )
    expect(verifyMcpAccessToken(legacy, config).ok).toBe(false)
  })
})

describe('opaque secrets', () => {
  it('generates high-entropy, url-safe secrets and hashes them deterministically', () => {
    const a = generateOpaqueSecret()
    const b = generateOpaqueSecret()
    expect(a).not.toEqual(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(43)
    expect(hashOpaqueSecret(a)).toBe(hashOpaqueSecret(a))
    expect(hashOpaqueSecret(a)).not.toBe(hashOpaqueSecret(b))
    // The stored value must not be the secret itself.
    expect(hashOpaqueSecret(a)).not.toBe(a)
  })
})
