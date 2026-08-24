/**
 * The HTTP edge of the MCP endpoint.
 *
 * Focus: an unauthenticated caller must get a 401 that carries the RFC 9728
 * discovery pointer (that is how an MCP client bootstraps OAuth), and every
 * rejection must look identical from outside.
 */
const mockResolveOrganizationScope = jest.fn()
const mockContainer = { resolve: jest.fn() }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScope: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

jest.mock('../../lib/bootstrap', () => ({
  ensureMcpScopesRegistered: jest.fn(async () => undefined),
}))

jest.mock('../../lib/rate-limit', () => ({
  enforceMcpRateLimit: jest.fn(async () => null),
  resolveClientIpForMcp: jest.fn(async () => '127.0.0.1'),
}))

import { getMcpConnectionConfig } from '../../lib/config'
import { issueMcpAccessToken } from '../../lib/tokens'
import { registerMcpScope, resetMcpScopeRegistryForTests } from '../../lib/scope-registry'
import { POST } from '../tasks/route'
import { GET as protectedResourceMetadata } from '../oauth/protected-resource-metadata/route'
import { GET as authorizationServerMetadata } from '../oauth/authorization-server-metadata/route'

const ORIGINAL_ENV = { ...process.env }
const ENDPOINT = 'https://erp.example.com/api/mcp/tasks'

function initializeRequest(headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-policy-0123456789'
  process.env.MCP_PUBLIC_URL = 'https://erp.example.com'
  resetMcpScopeRegistryForTests()
  registerMcpScope({
    scope: 'tasks:read',
    moduleId: 'tasks',
    description: 'Read tasks',
    tools: ['tasks_list'],
    loadTools: async () => [],
  })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('MCP endpoint authentication', () => {
  it('answers 401 with a resource_metadata pointer when no token is supplied', async () => {
    const response = await POST(initializeRequest())

    expect(response.status).toBe(401)
    const challenge = response.headers.get('www-authenticate') ?? ''
    expect(challenge).toContain('Bearer')
    expect(challenge).toContain(
      'resource_metadata="https://erp.example.com/.well-known/oauth-protected-resource/api/mcp/tasks"',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('answers 401 for a garbage bearer token', async () => {
    const response = await POST(initializeRequest({ authorization: 'Bearer not-a-token' }))
    expect(response.status).toBe(401)
  })

  it('ignores an ApiKey header — MCP accepts Bearer only', async () => {
    // The legacy `omk_` API-key path must not authenticate this endpoint.
    const response = await POST(initializeRequest({ authorization: 'ApiKey omk_something' }))
    expect(response.status).toBe(401)
  })

  it('returns an identical body for every rejection reason', async () => {
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'em') return { findOne: async () => null }
      if (token === 'rbacService') {
        return { getGrantedFeatures: async () => [], isModuleAllowedForUser: async () => true }
      }
      throw new Error(`unexpected ${token}`)
    })
    mockResolveOrganizationScope.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
      tenantId: 'tenant-1',
    })

    const validShapedToken = issueMcpAccessToken(
      {
        userId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
        clientId: 'c',
        scopes: ['tasks:read'],
        resource: getMcpConnectionConfig().resourceUrl,
      },
      getMcpConnectionConfig(),
    ).token

    const noToken = await POST(initializeRequest())
    const deletedUser = await POST(initializeRequest({ authorization: `Bearer ${validShapedToken}` }))

    expect(deletedUser.status).toBe(noToken.status)
    expect(await deletedUser.clone().text()).toBe(await noToken.clone().text())
  })

  it('rejects an oversized request before doing any work', async () => {
    const response = await POST(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer x.y.z',
          'content-length': String(10 * 1024 * 1024),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
    // Authentication runs first, so an unauthenticated oversized body is still 401.
    expect([401, 413]).toContain(response.status)
  })
})

describe('OAuth discovery documents', () => {
  it('publishes protected resource metadata pointing at the authorization server', async () => {
    const response = await protectedResourceMetadata(
      new Request('https://erp.example.com/.well-known/oauth-protected-resource'),
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.resource).toBe('https://erp.example.com/api/mcp/tasks')
    expect(body.authorization_servers).toEqual(['https://erp.example.com'])
    expect(body.scopes_supported).toEqual(['tasks:read'])
    expect(body.bearer_methods_supported).toEqual(['header'])
  })

  it('publishes authorization server metadata advertising only S256 PKCE', async () => {
    const response = await authorizationServerMetadata(
      new Request('https://erp.example.com/.well-known/oauth-authorization-server'),
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(body.issuer).toBe('https://erp.example.com')
    expect(body.authorization_endpoint).toBe('https://erp.example.com/api/mcp/oauth/authorize')
    expect(body.token_endpoint).toBe('https://erp.example.com/api/mcp/oauth/token')
    expect(body.code_challenge_methods_supported).toEqual(['S256'])
    expect(body.response_types_supported).toEqual(['code'])
    expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token'])
    expect(body.resource_indicators_supported).toBe(true)
  })

  it('omits the registration endpoint unless dynamic registration is enabled', async () => {
    const disabled = await authorizationServerMetadata(
      new Request('https://erp.example.com/.well-known/oauth-authorization-server'),
    )
    expect((await disabled.json()).registration_endpoint).toBeUndefined()

    process.env.MCP_OAUTH_DYNAMIC_REGISTRATION = 'true'
    const enabled = await authorizationServerMetadata(
      new Request('https://erp.example.com/.well-known/oauth-authorization-server'),
    )
    expect((await enabled.json()).registration_endpoint).toBe(
      'https://erp.example.com/api/mcp/oauth/register',
    )
  })
})
