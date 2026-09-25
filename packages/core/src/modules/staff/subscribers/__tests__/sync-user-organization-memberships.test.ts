const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import handle, { metadata } from '../sync-user-organization-memberships'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const ORG_A = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const ORG_C = '55555555-5555-4555-8555-555555555555'
const ROLE_A = '66666666-6666-4666-8666-666666666666'

describe('staff membership provisioning subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates desired automatic profiles, reactivates existing ones, and archives removed automatic profiles', async () => {
    const existingAuto = { organizationId: ORG_A, isAutoProvisioned: true, isActive: false }
    const existingManual = { organizationId: ORG_B, isAutoProvisioned: false, isActive: false }
    const removedAuto = { organizationId: ORG_C, isAutoProvisioned: true, isActive: true }
    findOneWithDecryptionMock.mockResolvedValue({ id: USER_ID, name: 'Employee', email: 'employee@example.com' })
    findWithDecryptionMock.mockResolvedValue([existingAuto, existingManual, removedAuto])

    const created: Array<Record<string, unknown>> = []
    const em = {
      find: jest.fn(),
      create: jest.fn((_entity: unknown, input: Record<string, unknown>) => {
        created.push(input)
        return input
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }

    await handle({ userId: USER_ID, tenantId: TENANT_ID, organizationIds: [ORG_A, ORG_B] }, {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as T
        throw new Error(`Unexpected dependency: ${name}`)
      },
    })

    expect(existingAuto.isActive).toBe(true)
    expect(existingManual.isActive).toBe(false)
    expect(removedAuto.isActive).toBe(false)
    expect(created).toHaveLength(0)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('creates a profile for an organization with no existing member', async () => {
    findOneWithDecryptionMock.mockResolvedValue({ id: USER_ID, name: 'Employee', email: 'employee@example.com' })
    findWithDecryptionMock.mockResolvedValue([])
    const em = {
      create: jest.fn((_entity: unknown, input: Record<string, unknown>) => input),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }

    await handle({ userId: USER_ID, tenantId: TENANT_ID, organizationIds: [ORG_A] }, {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as T
        throw new Error(`Unexpected dependency: ${name}`)
      },
    })

    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: ORG_A,
      userId: USER_ID,
      displayName: 'Employee',
      isAutoProvisioned: true,
      isActive: true,
    }))
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('synchronizes explicit staff role assignments by organization', async () => {
    const existing = { organizationId: ORG_A, isAutoProvisioned: true, isActive: true, roleIds: [] as string[] }
    findOneWithDecryptionMock.mockResolvedValue({ id: USER_ID, name: 'Employee', email: 'employee@example.com' })
    findWithDecryptionMock.mockImplementation(async (_em: unknown, _entity: unknown, filters: Record<string, unknown>) => {
      if (filters.id) return [{ id: ROLE_A, organizationId: ORG_A }]
      return [existing]
    })
    const em = {
      create: jest.fn((_entity: unknown, input: Record<string, unknown>) => input),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }

    await handle({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationIds: [ORG_A],
      staffRoleAssignments: [{ organizationId: ORG_A, roleIds: [ROLE_A] }],
    }, {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as T
        throw new Error(`Unexpected dependency: ${name}`)
      },
    })

    expect(existing.roleIds).toEqual([ROLE_A])
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('declares a persistent exact-match subscriber', () => {
    expect(metadata).toEqual({
      event: 'auth.user.organization_memberships_changed',
      persistent: true,
      id: 'staff:sync-user-organization-memberships',
    })
  })
})
