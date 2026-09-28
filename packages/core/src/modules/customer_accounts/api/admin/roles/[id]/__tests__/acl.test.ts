/** @jest-environment node */

/**
 * Optimistic-lock + mutation-guard coverage for the customer role ACL route (#3194).
 *
 * The ACL `PUT` mutates customer-portal permissions for the role aggregate. It
 * must guard against stale overwrites (two admins editing the same role) with
 * the same structured 409 the role route returns, run the generic mutation
 * guard before/after the write, bump the role's `updatedAt` so a stale role-edit
 * screen cannot save old permission arrays, and invalidate the RBAC cache.
 */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const foreignOrganizationId = '22222222-2222-4222-8222-222222222223'
const userId = '33333333-3333-4333-8333-333333333333'
const roleId = '44444444-4444-4444-8444-444444444444'
const aclRowId = '55555555-5555-4555-8555-555555555555'

const CURRENT_VERSION = '2026-06-18T08:42:20.999Z'
const STALE_VERSION = '2026-06-18T08:42:18.123Z'

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

class CustomerRoleStub {}
class CustomerRoleAclStub {}

const em = {
  findOne: jest.fn(),
  nativeUpdate: jest.fn(async () => 1),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: aclRowId, ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const rbacService = {
  userHasAllFeatures: jest.fn(async () => true),
}

const invalidateRoleCacheMock = jest.fn(async () => undefined)
const customerRbacService = {
  invalidateRoleCache: invalidateRoleCacheMock,
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'customerRbacService') return customerRbacService
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const runRouteMutationGuardsMock = jest.fn(async () => null as unknown)
const runAfterSuccessMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/data/entities', () => ({
  CustomerRole: CustomerRoleStub,
  CustomerRoleAcl: CustomerRoleAclStub,
}))

jest.mock('@open-mercato/core/modules/auth/services/rbacService', () => ({ RbacService: class {} }))
jest.mock('@open-mercato/core/modules/customer_accounts/services/customerRbacService', () => ({ CustomerRbacService: class {} }))

import { PUT } from '../acl'

function makeRequest(features: string[], expectedVersion: string | null): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (expectedVersion != null) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expectedVersion)
  return new Request(`https://example.test/api/customer_accounts/admin/roles/${roleId}/acl`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ features }),
  })
}

describe('customer role ACL PUT — optimistic locking + mutation guard (#3194)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_OPTIMISTIC_LOCK = 'all'
    em.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerRoleStub) {
        return { id: roleId, tenantId, updatedAt: new Date(CURRENT_VERSION), name: 'Buyer' }
      }
      if (entity === CustomerRoleAclStub) {
        return { id: aclRowId, tenantId, featuresJson: ['portal.profile.view'], isPortalAdmin: false }
      }
      return null
    })
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
  })

  afterAll(() => {
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  it('returns the structured 409 conflict body when the expected version is stale', async () => {
    const res = await PUT(makeRequest(['portal.orders.view'], STALE_VERSION), { params: { id: roleId } })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(invalidateRoleCacheMock).not.toHaveBeenCalled()
  })

  it('writes the ACL, bumps the role version, invalidates the cache, and returns the new updatedAt on a matching version', async () => {
    const res = await PUT(makeRequest(['portal.orders.view'], CURRENT_VERSION), { params: { id: roleId } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.updatedAt).toBe('string')
    expect(body.updatedAt).not.toBe(CURRENT_VERSION)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerRoleAclStub,
      { id: aclRowId },
      expect.objectContaining({ featuresJson: ['portal.orders.view'] }),
    )
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerRoleStub,
      { id: roleId },
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    )
    expect(invalidateRoleCacheMock).toHaveBeenCalledWith(roleId)
  })

  it('succeeds without a version header (strictly additive — plain API consumers keep working)', async () => {
    const res = await PUT(makeRequest(['portal.orders.view'], null), { params: { id: roleId } })
    expect(res.status).toBe(200)
    expect(invalidateRoleCacheMock).toHaveBeenCalledWith(roleId)
  })

  it('blocks the write when the generic mutation guard rejects it', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'locked' } })
    const res = await PUT(makeRequest(['portal.orders.view'], CURRENT_VERSION), { params: { id: roleId } })
    expect(res.status).toBe(423)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(invalidateRoleCacheMock).not.toHaveBeenCalled()
  })

  it('runs the mutation-guard after-success hook when the guard requests it', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: true, runAfterSuccess: runAfterSuccessMock })
    const res = await PUT(makeRequest(['portal.orders.view'], CURRENT_VERSION), { params: { id: roleId } })
    expect(res.status).toBe(200)
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('returns 404 when the role does not exist', async () => {
    em.findOne.mockImplementation(async () => null)
    const res = await PUT(makeRequest(['portal.orders.view'], CURRENT_VERSION), { params: { id: roleId } })
    expect(res.status).toBe(404)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 instead of mutating a role owned by another organization in the same tenant', async () => {
    em.findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CustomerRoleStub && where.organizationId !== organizationId) {
        return {
          id: roleId,
          tenantId,
          organizationId: foreignOrganizationId,
          updatedAt: new Date(CURRENT_VERSION),
          name: 'Foreign Buyer',
        }
      }
      return null
    })

    const res = await PUT(makeRequest(['portal.orders.view'], CURRENT_VERSION), { params: { id: roleId } })

    expect(res.status).toBe(404)
    expect(em.findOne).toHaveBeenCalledWith(CustomerRoleStub, {
      id: roleId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(invalidateRoleCacheMock).not.toHaveBeenCalled()
  })
})
