import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  undo?: (args: { ctx: unknown; logEntry: unknown }) => Promise<void>
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const PROFILE_ID = '44444444-4444-4444-8444-444444444444'
const MEMBER_ID = '55555555-5555-4555-8555-555555555555'

async function loadCommands(): Promise<{ update: RegisteredCommand; del: RegisteredCommand }> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../employee-profiles')
  return {
    update: commandRegistry.get('staff.employee-profiles.update') as RegisteredCommand,
    del: commandRegistry.get('staff.employee-profiles.delete') as RegisteredCommand,
  }
}

function createProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    member: { id: MEMBER_ID },
    employeeNumber: 'QA-588-001',
    jobTitle: 'QA Engineer',
    employmentType: 'full_time',
    startDate: '2026-09-22',
    endDate: null,
    workPhone: null,
    personalPhone: null,
    personalEmail: null,
    dateOfBirth: null,
    notes: null,
    deletedAt: null,
    updatedAt: new Date('2026-09-22T00:00:00.000Z'),
    ...overrides,
  }
}

function createEm() {
  const em = {
    fork: jest.fn(),
    findOne: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createContext(em: unknown) {
  return {
    auth: {
      sub: 'admin-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      isSuperAdmin: false,
    },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
    container: {
      resolve: (name: string) => (name === 'em' ? em : null),
    } as unknown as AwilixContainer,
  }
}

describe('employee profile mutation organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('limits profile updates to the active organization', async () => {
    const { update } = await loadCommands()
    const em = createEm()
    const profile = createProfile()
    em.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === PROFILE_ID && where.tenantId === TENANT_ID && where.organizationId === ORG_ID) return profile
      return null
    })

    await expect(
      update.execute({ id: PROFILE_ID, jobTitle: 'Updated title' }, createContext(em)),
    ).resolves.toEqual({ profileId: PROFILE_ID })

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: PROFILE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      }),
      { populate: ['member'] },
    )
    expect(profile.jobTitle).toBe('Updated title')
  })

  it('rejects updates and deletes for a profile in another organization', async () => {
    const { update, del } = await loadCommands()
    const em = createEm()
    const foreignProfile = createProfile({ organizationId: OTHER_ORG_ID })
    em.findOne.mockResolvedValue(null)
    const context = createContext(em)

    await expect(
      update.execute({ id: PROFILE_ID, jobTitle: 'Cross-org update' }, context),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })
    await expect(del.execute({ id: PROFILE_ID }, context)).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })

    expect(foreignProfile.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.findOne).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }),
      { populate: ['member'] },
    )
    expect(em.findOne).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }),
    )
  })

  it('scopes delete undo loads to the organization stored in the snapshot', async () => {
    const { del } = await loadCommands()
    const em = createEm()
    em.findOne.mockResolvedValue(null)

    await del.undo?.({
      ctx: createContext(em),
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: PROFILE_ID,
              tenantId: TENANT_ID,
              organizationId: OTHER_ORG_ID,
            },
          },
        },
      },
    })

    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
      id: PROFILE_ID,
      tenantId: TENANT_ID,
      organizationId: OTHER_ORG_ID,
    })
  })
})
