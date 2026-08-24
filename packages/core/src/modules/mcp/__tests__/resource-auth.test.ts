/**
 * The gate every MCP request passes through.
 *
 * A valid token is treated as a *claim*, never as an answer. These tests pin the
 * re-validation that happens on every request: the user still exists, still
 * belongs to that tenant, may still act in that organization, and still holds
 * grants in an entitled module.
 */
const mockResolveOrganizationScope = jest.fn()

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScope: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

import { getMcpConnectionConfig } from '../lib/config'
import { issueMcpAccessToken } from '../lib/tokens'
import { authenticateMcpResourceRequest, extractBearerToken } from '../lib/resource-auth'
import {
  registerMcpScope,
  resetMcpScopeRegistryForTests,
} from '../lib/scope-registry'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '99999999-9999-4999-8999-999999999999'
const ORG_A = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'

const ORIGINAL_ENV = { ...process.env }

function config() {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-policy-0123456789'
  process.env.MCP_PUBLIC_URL = 'https://erp.example.com'
  return getMcpConnectionConfig()
}

type ContainerOverrides = {
  user?: Record<string, unknown> | null
  grantedFeatures?: string[]
  moduleAllowed?: boolean
}

function buildContainer(overrides: ContainerOverrides = {}) {
  const {
    user = { id: USER_ID, tenantId: TENANT_A, isConfirmed: true, deletedAt: null },
    grantedFeatures = ['tasks.view', 'tasks.create'],
    moduleAllowed = true,
  } = overrides

  const em = { findOne: jest.fn().mockResolvedValue(user) }
  const rbacService = {
    getGrantedFeatures: jest.fn().mockResolvedValue(grantedFeatures),
    isModuleAllowedForUser: jest.fn().mockResolvedValue(moduleAllowed),
  }

  return {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'rbacService') return rbacService
      throw new Error(`unexpected resolve(${token})`)
    },
    __em: em,
    __rbac: rbacService,
  } as never
}

function tokenFor(overrides: Partial<Parameters<typeof issueMcpAccessToken>[0]> = {}) {
  const cfg = config()
  return issueMcpAccessToken(
    {
      userId: USER_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      clientId: 'mcp_client',
      scopes: ['tasks:read'],
      resource: cfg.resourceUrl,
      ...overrides,
    },
    cfg,
  ).token
}

beforeEach(() => {
  jest.clearAllMocks()
  resetMcpScopeRegistryForTests()
  registerMcpScope({
    scope: 'tasks:read',
    moduleId: 'tasks',
    description: 'Read tasks',
    tools: ['tasks_list'],
    loadTools: async () => [],
  })
  // Default: the organization the token names is honored.
  mockResolveOrganizationScope.mockResolvedValue({
    selectedId: ORG_A,
    filterIds: [ORG_A],
    allowedIds: [ORG_A],
    tenantId: TENANT_A,
  })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('bearer extraction', () => {
  it('reads a Bearer token from the Authorization header', () => {
    const headers = new Headers({ authorization: 'Bearer abc.def.ghi' })
    expect(extractBearerToken(headers)).toBe('abc.def.ghi')
  })

  it('ignores other authorization schemes', () => {
    expect(extractBearerToken(new Headers({ authorization: 'ApiKey omk_secret' }))).toBeNull()
    expect(extractBearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull()
    expect(extractBearerToken(new Headers())).toBeNull()
  })

  it('ignores an empty bearer value', () => {
    expect(extractBearerToken(new Headers({ authorization: 'Bearer   ' }))).toBeNull()
  })
})

describe('MCP resource authentication', () => {
  it('accepts a valid token and returns live grants', async () => {
    const container = buildContainer()
    const result = await authenticateMcpResourceRequest(tokenFor(), container, config())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.context.userId).toBe(USER_ID)
    expect(result.context.tenantId).toBe(TENANT_A)
    expect(result.context.organizationId).toBe(ORG_A)
    expect(result.context.scopes).toEqual(['tasks:read'])
    expect(result.context.grantedFeatures).toEqual(['tasks.view', 'tasks.create'])
  })

  it('rejects a missing token', async () => {
    const result = await authenticateMcpResourceRequest(null, buildContainer(), config())
    expect(result).toEqual({ ok: false, reason: 'missing_token' })
  })

  it('rejects a malformed token', async () => {
    const result = await authenticateMcpResourceRequest('garbage', buildContainer(), config())
    expect(result).toEqual({ ok: false, reason: 'malformed_token' })
  })

  it('rejects a token whose scopes are all unknown to this deployment', async () => {
    resetMcpScopeRegistryForTests()
    const result = await authenticateMcpResourceRequest(tokenFor(), buildContainer(), config())
    expect(result).toEqual({ ok: false, reason: 'no_effective_scopes' })
  })

  it('rejects a token for a user that no longer exists', async () => {
    const container = buildContainer({ user: null })
    const result = await authenticateMcpResourceRequest(tokenFor(), container, config())
    expect(result).toEqual({ ok: false, reason: 'unknown_user' })
  })

  it('rejects a token for a deactivated user', async () => {
    const container = buildContainer({
      user: { id: USER_ID, tenantId: TENANT_A, isConfirmed: false, deletedAt: null },
    })
    const result = await authenticateMcpResourceRequest(tokenFor(), container, config())
    expect(result).toEqual({ ok: false, reason: 'unknown_user' })
  })

  it('scopes the user lookup to the token tenant, so a cross-tenant subject cannot resolve', async () => {
    const container = buildContainer()
    await authenticateMcpResourceRequest(tokenFor({ tenantId: TENANT_B }), container, config())

    // The lookup must be filtered by the tenant from the token — never by id alone.
    expect((container as never as { __em: { findOne: jest.Mock } }).__em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: USER_ID, tenantId: TENANT_B, deletedAt: null }),
    )
  })

  it('rejects when the organization in the token is no longer selectable', async () => {
    mockResolveOrganizationScope.mockResolvedValue({
      selectedId: ORG_B,
      filterIds: [ORG_B],
      allowedIds: [ORG_B],
      tenantId: TENANT_A,
      selectionRejected: true,
    })
    const result = await authenticateMcpResourceRequest(tokenFor(), buildContainer(), config())
    expect(result).toEqual({ ok: false, reason: 'organization_denied' })
  })

  it('rejects when the resolved organization differs from the token (no silent fallback)', async () => {
    // A degraded resolution that quietly substitutes another org must not be
    // accepted — that would silently move the session into a different scope.
    mockResolveOrganizationScope.mockResolvedValue({
      selectedId: ORG_B,
      filterIds: [ORG_B],
      allowedIds: [ORG_B],
      tenantId: TENANT_A,
    })
    const result = await authenticateMcpResourceRequest(tokenFor(), buildContainer(), config())
    expect(result).toEqual({ ok: false, reason: 'organization_denied' })
  })

  it('rejects when the resolved tenant differs from the token', async () => {
    mockResolveOrganizationScope.mockResolvedValue({
      selectedId: ORG_A,
      filterIds: [ORG_A],
      allowedIds: [ORG_A],
      tenantId: TENANT_B,
    })
    const result = await authenticateMcpResourceRequest(tokenFor(), buildContainer(), config())
    expect(result).toEqual({ ok: false, reason: 'organization_denied' })
  })

  it('rejects when the user holds no grants in scope (revoked access)', async () => {
    const container = buildContainer({ grantedFeatures: [] })
    const result = await authenticateMcpResourceRequest(tokenFor(), container, config())
    expect(result).toEqual({ ok: false, reason: 'module_unavailable' })
  })

  it('rejects when the tasks module is not available to the user', async () => {
    const container = buildContainer({ moduleAllowed: false })
    const result = await authenticateMcpResourceRequest(tokenFor(), container, config())
    expect(result).toEqual({ ok: false, reason: 'module_unavailable' })
  })

  it('reads grants for the exact tenant + organization the token names', async () => {
    const container = buildContainer()
    await authenticateMcpResourceRequest(tokenFor(), container, config())
    const rbac = (container as never as { __rbac: { getGrantedFeatures: jest.Mock } }).__rbac
    expect(rbac.getGrantedFeatures).toHaveBeenCalledWith(USER_ID, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
    })
  })

  it('never asks for scope resolution as a super admin', async () => {
    // A super-admin bypass would defeat organization scoping for MCP sessions.
    await authenticateMcpResourceRequest(tokenFor(), buildContainer(), config())
    expect(mockResolveOrganizationScope).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ isSuperAdmin: false }),
      }),
    )
  })
})
