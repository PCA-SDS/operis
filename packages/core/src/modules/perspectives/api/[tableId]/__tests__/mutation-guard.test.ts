/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const perspectiveId = '44444444-4444-4444-8444-444444444444'
const roleId = '55555555-5555-4555-8555-555555555555'
const tableId = 'customers.deals'

const em = {
  find: jest.fn(),
  findOne: jest.fn(),
}
const cache = {}
const rbacService = {
  userHasAllFeatures: jest.fn(),
}
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'cache') return cache
    if (name === 'rbacService') return rbacService
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const runRoleAfterSuccessMock = jest.fn()
const withAtomicFlushMock = jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
  for (const phase of phases) {
    await phase()
  }
})
const saveUserPerspectiveMock = jest.fn()
const saveRolePerspectivesMock = jest.fn()
const clearRolePerspectivesMock = jest.fn()
const deleteUserPerspectiveMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
    roles: [],
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: (...args: unknown[]) => withAtomicFlushMock(...args),
}))

jest.mock('../../../services/perspectiveService', () => ({
  loadPerspectivesState: jest.fn(),
  saveUserPerspective: (...args: unknown[]) => saveUserPerspectiveMock(...args),
  saveRolePerspectives: (...args: unknown[]) => saveRolePerspectivesMock(...args),
  clearRolePerspectives: (...args: unknown[]) => clearRolePerspectivesMock(...args),
  deleteUserPerspective: (...args: unknown[]) => deleteUserPerspectiveMock(...args),
}))

import { POST } from '../route'
import { DELETE as DELETE_PERSONAL } from '../[perspectiveId]/route'
import { DELETE as DELETE_ROLE } from '../roles/[roleId]/route'

describe('perspectives custom write mutation guards', () => {
  beforeEach(() => {
    container.resolve.mockClear()
    runRouteMutationGuardsMock.mockReset()
    runAfterSuccessMock.mockReset()
    runRoleAfterSuccessMock.mockReset()
    withAtomicFlushMock.mockReset()
    saveUserPerspectiveMock.mockReset()
    saveRolePerspectivesMock.mockReset()
    clearRolePerspectivesMock.mockReset()
    deleteUserPerspectiveMock.mockReset()
    rbacService.userHasAllFeatures.mockReset()
    em.find.mockReset()
    em.findOne.mockReset()
    runRouteMutationGuardsMock.mockImplementation(async ({ input }: { input: { resourceKind: string } }) => ({
      ok: true,
      runAfterSuccess: input.resourceKind === 'perspectives.role_perspective' ? runRoleAfterSuccessMock : runAfterSuccessMock,
    }))
    runAfterSuccessMock.mockResolvedValue(undefined)
    runRoleAfterSuccessMock.mockResolvedValue(undefined)
    withAtomicFlushMock.mockImplementation(async (_em: unknown, phases: Array<() => unknown>) => {
      for (const phase of phases) {
        await phase()
      }
    })
    saveUserPerspectiveMock.mockResolvedValue({
      id: perspectiveId,
      tableId,
      name: 'Pipeline',
      settings: {},
      isDefault: false,
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z',
    })
    saveRolePerspectivesMock.mockResolvedValue([])
    clearRolePerspectivesMock.mockResolvedValue(1)
    deleteUserPerspectiveMock.mockResolvedValue(true)
    rbacService.userHasAllFeatures.mockResolvedValue(false)
    em.find.mockResolvedValue([])
    em.findOne.mockResolvedValue({ id: roleId, tenantId, deletedAt: null })
  })

  it('wraps the save route with validation before the atomic write and after-success after commit', async () => {
    const response = await POST(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          perspectiveId,
          name: 'Pipeline',
          settings: {},
          isDefault: false,
        }),
      }),
      { params: { tableId } },
    )

    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'perspectives.perspective',
          resourceId: perspectiveId,
          operation: 'custom',
          mutationPayload: expect.objectContaining({ perspectiveId, name: 'Pipeline' }),
        }),
      }),
    )
    expect(withAtomicFlushMock).toHaveBeenCalledWith(em, expect.any(Array), { transaction: true })
    expect(saveUserPerspectiveMock).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock.mock.invocationCallOrder[0]).toBeLessThan(
      saveUserPerspectiveMock.mock.invocationCallOrder[0],
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
    expect(saveUserPerspectiveMock.mock.invocationCallOrder[0]).toBeLessThan(
      runAfterSuccessMock.mock.invocationCallOrder[0],
    )
  })

  it('short-circuits the save route when the mutation guard rejects', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 409, errorBody: { error: { code: 'RECORD_LOCKED' } } })

    const response = await POST(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          perspectiveId,
          name: 'Pipeline',
          settings: {},
        }),
      }),
      { params: { tableId } },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: { code: 'RECORD_LOCKED' } })
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
    expect(saveUserPerspectiveMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('wraps role perspective mutations from the save route with mutation guards', async () => {
    rbacService.userHasAllFeatures.mockResolvedValueOnce(true)
    em.find.mockResolvedValueOnce([{ id: roleId, tenantId, deletedAt: null }])

    const response = await POST(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          perspectiveId,
          name: 'Pipeline',
          settings: {},
          applyToRoles: [roleId],
          setRoleDefault: true,
        }),
      }),
      { params: { tableId } },
    )

    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'perspectives.role_perspective',
          resourceId: roleId,
          operation: 'custom',
          mutationPayload: expect.objectContaining({ tableId, applyToRoles: [roleId] }),
        }),
      }),
    )
    expect(saveRolePerspectivesMock).toHaveBeenCalledWith(em, cache, expect.objectContaining({
      tableId,
      tenantId,
      organizationId,
      input: expect.objectContaining({ roleIds: [roleId], setDefault: true }),
    }))
    expect(runAfterSuccessMock).toHaveBeenCalledTimes(1)
    expect(runRoleAfterSuccessMock).toHaveBeenCalledTimes(1)
  })

  it('short-circuits role perspective mutations from the save route when the role guard rejects', async () => {
    rbacService.userHasAllFeatures.mockResolvedValueOnce(true)
    em.find.mockResolvedValueOnce([{ id: roleId, tenantId, deletedAt: null }])
    runRouteMutationGuardsMock
      .mockResolvedValueOnce({ ok: true, runAfterSuccess: runAfterSuccessMock })
      .mockResolvedValueOnce({
        ok: false,
        errorStatus: 409,
        errorBody: { error: { code: 'ROLE_PERSPECTIVE_LOCKED' } },
      })

    const response = await POST(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          perspectiveId,
          name: 'Pipeline',
          settings: {},
          applyToRoles: [roleId],
        }),
      }),
      { params: { tableId } },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: { code: 'ROLE_PERSPECTIVE_LOCKED' } })
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
    expect(saveUserPerspectiveMock).not.toHaveBeenCalled()
    expect(saveRolePerspectivesMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
    expect(runRoleAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('does not run role after-success for clear-only save route no-ops', async () => {
    rbacService.userHasAllFeatures.mockResolvedValueOnce(true)
    em.find.mockResolvedValueOnce([{ id: roleId, tenantId, deletedAt: null }])
    clearRolePerspectivesMock.mockResolvedValueOnce(0)

    const response = await POST(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          perspectiveId,
          name: 'Pipeline',
          settings: {},
          clearRoleIds: [roleId],
        }),
      }),
      { params: { tableId } },
    )

    expect(response.status).toBe(200)
    expect(clearRolePerspectivesMock).toHaveBeenCalledWith(em, cache, expect.objectContaining({
      tableId,
      tenantId,
      organizationId,
      roleIds: [roleId],
    }))
    expect(runAfterSuccessMock).toHaveBeenCalledTimes(1)
    expect(runRoleAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('wraps personal perspective deletes with mutation guards', async () => {
    const response = await DELETE_PERSONAL(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}/${perspectiveId}`, {
        method: 'DELETE',
      }),
      { params: { tableId, perspectiveId } },
    )

    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'perspectives.perspective',
          resourceId: perspectiveId,
          operation: 'delete',
          mutationPayload: { tableId, perspectiveId },
        }),
      }),
    )
    expect(deleteUserPerspectiveMock).toHaveBeenCalled()
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('does not run after-success for personal perspective delete no-ops', async () => {
    deleteUserPerspectiveMock.mockResolvedValueOnce(false)

    const response = await DELETE_PERSONAL(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}/${perspectiveId}`, {
        method: 'DELETE',
      }),
      { params: { tableId, perspectiveId } },
    )

    expect(response.status).toBe(200)
    expect(deleteUserPerspectiveMock).toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('wraps role perspective clears with mutation guards', async () => {
    const response = await DELETE_ROLE(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}/roles/${roleId}`, {
        method: 'DELETE',
      }),
      { params: { tableId, roleId } },
    )

    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'perspectives.role_perspective',
          resourceId: roleId,
          operation: 'delete',
          mutationPayload: { tableId, roleId },
        }),
      }),
    )
    expect(clearRolePerspectivesMock).toHaveBeenCalledWith(em, cache, expect.objectContaining({
      tableId,
      tenantId,
      organizationId,
      roleIds: [roleId],
    }))
    expect(runRoleAfterSuccessMock).toHaveBeenCalledTimes(1)
  })

  it('does not run after-success for role perspective clear no-ops', async () => {
    clearRolePerspectivesMock.mockResolvedValueOnce(0)

    const response = await DELETE_ROLE(
      new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}/roles/${roleId}`, {
        method: 'DELETE',
      }),
      { params: { tableId, roleId } },
    )

    expect(response.status).toBe(200)
    expect(clearRolePerspectivesMock).toHaveBeenCalledWith(em, cache, expect.objectContaining({
      tableId,
      tenantId,
      organizationId,
      roleIds: [roleId],
    }))
    expect(runRoleAfterSuccessMock).not.toHaveBeenCalled()
  })
})
