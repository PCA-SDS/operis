import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { ChatParticipant } from '@open-mercato/core/modules/chat/data/entities'
import { DefaultChatTaskAssignmentService } from '../services/chatTaskAssignmentService'
import type { ChatTaskReadContext, ChatTaskService } from '../services/chatTaskService'

/**
 * The tasks module's own assignability predicate, asked about specific ids.
 *
 * Stubbed as the set of assignable users so each test still reads as "these
 * people are assignable"; the service narrows it to the candidates it was asked
 * about, which is what these assertions are really about.
 */
const assignablePool = jest.fn<Promise<Array<{ id: string }>>, unknown[]>()
jest.mock('@open-mercato/core/modules/tasks/lib/assignment', () => ({
  filterScopedUserIds: async (_em: unknown, _scope: unknown, ids: readonly string[]) => {
    const pool = new Set(((await assignablePool()) ?? []).map((person) => person.id))
    return new Set(ids.filter((id) => pool.has(id)))
  },
}))
/** Reads as "these people are assignable in this scope" at each call site. */
const assignable = { mockResolvedValue: (value: Array<{ id: string }>) => assignablePool.mockResolvedValue(value) }

const loadOrganizationMembers = jest.fn()
jest.mock('@open-mercato/core/modules/chat/lib/scope', () => ({
  chatDisplayName: (user: { name?: string; email: string }) => user.name ?? user.email,
  loadOrganizationMembers: (...args: unknown[]) => loadOrganizationMembers(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const DIRECT = '33333333-3333-4333-8333-333333333333'
const SPACE = '44444444-4444-4444-8444-444444444444'
const ME = '55555555-5555-4555-8555-555555555555'
const AMIR = '66666666-6666-4666-8666-666666666666'
const SAM = '77777777-7777-4777-8777-777777777777'
const INBOX = '88888888-8888-4888-8888-888888888888'

type Row = Record<string, unknown>

function fakeEm(participants: Row[]): EntityManager {
  return {
    async find(_entity: unknown, where: Row) {
      return participants.filter((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      )
    },
  } as unknown as EntityManager
}

function container(features: readonly string[]): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (name === 'rbacService') {
        return {
          async userHasAllFeatures(_userId: string, required: string[]) {
            return required.every((feature) => features.includes(feature))
          },
        }
      }
      if (name === 'tasksProjectService') {
        return { async ensureInbox() { return { id: INBOX } } }
      }
      throw new Error(`[internal] unexpected token ${name}`)
    },
  } as unknown as AwilixContainer
}

/**
 * A chat service stub that grants access and reports one conversation kind.
 *
 * Access is covered exhaustively by `chatTaskService.test.ts`; this suite is about
 * what happens AFTER access is proved, so stubbing it keeps each test about one rule.
 */
function chatTasks(kind: 'direct' | 'space'): ChatTaskService {
  return {
    async requireConversationAccess() {
      return {
        conversation: { id: kind === 'direct' ? DIRECT : SPACE, kind } as never,
        participant: {} as never,
      }
    },
  } as unknown as ChatTaskService
}

function ctx(participants: Row[], features: readonly string[]): ChatTaskReadContext {
  return {
    container: container(features),
    em: fakeEm(participants),
    scope: { tenantId: TENANT, organizationId: ORG },
    userId: ME,
  }
}

const roster = (conversationId: string, userIds: string[]): Row[] =>
  userIds.map((userId) => ({ tenantId: TENANT, organizationId: ORG, conversationId, userId }))

beforeEach(() => {
  jest.clearAllMocks()
  assignable.mockResolvedValue([{ id: ME }, { id: AMIR }, { id: SAM }])
  loadOrganizationMembers.mockImplementation(async (_em: unknown, _scope: unknown, ids: readonly string[]) => {
    const map = new Map<string, { id: string; name: string; email: string }>()
    for (const id of ids) map.set(id, { id, name: `Person ${id.slice(0, 4)}`, email: `${id}@qa.test` })
    return map
  })
})

const CREATOR = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.assign']

describe('a direct conversation', () => {
  const service = () => new DefaultChatTaskAssignmentService(chatTasks('direct'))

  it('defaults the assignee to the other person, read from participant rows', async () => {
    const context = await service().composerContext(ctx(roster(DIRECT, [ME, AMIR]), CREATOR), DIRECT)
    expect(context.defaultAssignee?.id).toBe(AMIR)
    expect(context.requiresExplicitAssignee).toBe(false)
    expect(context.defaultAssigneeBlockedReason).toBeNull()
  })

  it('uses that default when the caller names nobody', async () => {
    const resolved = await service().resolveAssignees(ctx(roster(DIRECT, [ME, AMIR]), CREATOR), {
      conversationId: DIRECT,
      requestedAssigneeIds: undefined,
      requestedRoleTargets: 0,
    })
    expect(resolved).toEqual([AMIR])
  })

  it('refuses with an actionable reason when the counterpart is no longer active', async () => {
    // Active in chat's sense: undeleted and confirmed. An unconfirmed or removed
    // account cannot sign in, so a task addressed to them would never be seen.
    loadOrganizationMembers.mockResolvedValue(new Map())
    const context = await service().composerContext(ctx(roster(DIRECT, [ME, AMIR]), CREATOR), DIRECT)
    expect(context.defaultAssignee).toBeNull()
    expect(context.defaultAssigneeBlockedReason).toBe('inactive')
    expect(context.requiresExplicitAssignee).toBe(true)

    await expect(
      service().resolveAssignees(ctx(roster(DIRECT, [ME, AMIR]), CREATOR), {
        conversationId: DIRECT,
        requestedAssigneeIds: undefined,
        requestedRoleTargets: 0,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('distinguishes "not assignable" from "inactive"', async () => {
    // Present in chat, absent from the tasks module's assignable set. The two need
    // different messages because they need different fixes.
    assignable.mockResolvedValue([{ id: ME }])
    const context = await service().composerContext(ctx(roster(DIRECT, [ME, AMIR]), CREATOR), DIRECT)
    expect(context.defaultAssigneeBlockedReason).toBe('not_assignable')
  })

  it('requires the assign grant even though the client named nobody', async () => {
    // Defaulting to the counterpart IS assigning to somebody else. Chat membership
    // must never be the thing that hands work to a colleague.
    await expect(
      service().resolveAssignees(ctx(roster(DIRECT, [ME, AMIR]), ['chat.view', 'tasks.view', 'tasks.create']), {
        conversationId: DIRECT,
        requestedAssigneeIds: undefined,
        requestedRoleTargets: 0,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('a space', () => {
  const service = () => new DefaultChatTaskAssignmentService(chatTasks('space'))

  it('has no default assignee and says so', async () => {
    const context = await service().composerContext(ctx(roster(SPACE, [ME, AMIR, SAM]), CREATOR), SPACE)
    expect(context.defaultAssignee).toBeNull()
    expect(context.requiresExplicitAssignee).toBe(true)
  })

  it('suggests the participants who are also assignable, and only those', async () => {
    assignable.mockResolvedValue([{ id: ME }, { id: AMIR }])
    const context = await service().composerContext(ctx(roster(SPACE, [ME, AMIR, SAM]), CREATOR), SPACE)
    expect(context.suggestedAssignees.map((person) => person.id)).toEqual([AMIR])
  })

  it('refuses a create with no assignee rather than choosing a participant', async () => {
    // "Everyone here" is not an assignee: a task addressed to a room is a task nobody
    // owns, and expanding it would hand one piece of work to every member.
    await expect(
      service().resolveAssignees(ctx(roster(SPACE, [ME, AMIR, SAM]), CREATOR), {
        conversationId: SPACE,
        requestedAssigneeIds: [],
        requestedRoleTargets: 0,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts an explicit assignee who is not in the conversation', async () => {
    // The suggestions come from the room because that is useful; the boundary is the
    // tasks module's assignment policy, not the roster.
    const resolved = await service().resolveAssignees(ctx(roster(SPACE, [ME, AMIR]), CREATOR), {
      conversationId: SPACE,
      requestedAssigneeIds: [SAM],
      requestedRoleTargets: 0,
    })
    expect(resolved).toEqual([SAM])
  })

  it('accepts a role target as an explicit audience', async () => {
    const resolved = await service().resolveAssignees(ctx(roster(SPACE, [ME, AMIR]), CREATOR), {
      conversationId: SPACE,
      requestedAssigneeIds: [],
      requestedRoleTargets: 1,
    })
    expect(resolved).toEqual([])
  })
})

describe('the personal workspace', () => {
  const service = () => new DefaultChatTaskAssignmentService(chatTasks('direct'))

  it('defaults the assignee to the caller', async () => {
    const resolved = await service().resolveAssignees(ctx([], CREATOR), {
      conversationId: null,
      requestedAssigneeIds: undefined,
      requestedRoleTargets: 0,
    })
    expect(resolved).toEqual([ME])
  })

  it('needs no assign grant to make a task for yourself', async () => {
    // Which is what makes the workspace usable by an employee who may create tasks
    // but not hand them to anybody else.
    const resolved = await service().resolveAssignees(ctx([], ['tasks.view', 'tasks.create']), {
      conversationId: null,
      requestedAssigneeIds: undefined,
      requestedRoleTargets: 0,
    })
    expect(resolved).toEqual([ME])
  })

  it('still needs the assign grant to name somebody else', async () => {
    await expect(
      service().resolveAssignees(ctx([], ['tasks.view', 'tasks.create']), {
        conversationId: null,
        requestedAssigneeIds: [AMIR],
        requestedRoleTargets: 0,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('the personal workspace', () => {
  const service = () => new DefaultChatTaskAssignmentService(chatTasks('direct'))
  const workspace = (over: Record<string, unknown> = {}) => ({
    conversationId: null,
    requestedAssigneeIds: undefined,
    requestedRoleTargets: 0,
    ...over,
  }) as Parameters<ReturnType<typeof service>['resolveAssignees']>[1]

  it('assigns to the caller when nobody was named', async () => {
    const resolved = await service().resolveAssignees(ctx([], CREATOR), workspace())
    expect(resolved).toEqual([ME])
  })

  it('does not need the assign grant to assign to yourself', async () => {
    // What makes the workspace usable by an employee who may create but not assign.
    const resolved = await service().resolveAssignees(
      ctx([], ['chat.view', 'tasks.view', 'tasks.create']),
      workspace(),
    )
    expect(resolved).toEqual([ME])
  })

  /**
   * The self-assign is a DEFAULT, so naming a role audience must switch it off.
   *
   * Testing only the explicit id list meant a workspace request that named roles
   * and no individuals got the caller added alongside them — a default quietly
   * overriding a choice the caller had actually made.
   */
  it('does not add the caller alongside a role audience they chose', async () => {
    const resolved = await service().resolveAssignees(ctx([], CREATOR), workspace({ requestedRoleTargets: 1 }))
    expect(resolved).toEqual([])
  })

  it('honours an explicit assignee list', async () => {
    const resolved = await service().resolveAssignees(
      ctx([], CREATOR),
      workspace({ requestedAssigneeIds: [AMIR] }),
    )
    expect(resolved).toEqual([AMIR])
  })

  it('still requires the assign grant to name somebody else', async () => {
    await expect(
      service().resolveAssignees(
        ctx([], ['chat.view', 'tasks.view', 'tasks.create']),
        workspace({ requestedAssigneeIds: [AMIR] }),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})
