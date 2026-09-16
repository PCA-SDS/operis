import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { ChatConversation, ChatMessage, ChatParticipant } from '@open-mercato/core/modules/chat/data/entities'
import { TasksProject, TasksTask, TasksTaskAssignee, TasksTaskAssignmentTarget } from '@open-mercato/core/modules/tasks/data/entities'
import { ChatTaskLink } from '../data/entities'
import { DefaultChatTaskService, type ChatTaskReadContext } from '../services/chatTaskService'

jest.mock('@open-mercato/core/modules/tasks/lib/assignment', () => ({
  loadAssignedTaskIds: jest.fn(async () => []),
}))

// Names are resolved through chat's active-member predicate in the real thing; the
// fake returns whatever it is asked for so the tests below are about authorization
// rather than about name resolution.
jest.mock('@open-mercato/core/modules/chat/lib/scope', () => ({
  chatDisplayName: (user: { name?: string; email: string }) => user.name ?? user.email,
  loadOrganizationMembers: jest.fn(async (_em: unknown, _scope: unknown, ids: readonly string[]) => {
    const map = new Map<string, { id: string; name: string; email: string }>()
    for (const id of ids) map.set(id, { id, name: `Person ${id.slice(0, 4)}`, email: `${id}@qa.test` })
    return map
  }),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999'
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const TASK = '44444444-4444-4444-8444-444444444444'
const USER = '55555555-5555-4555-8555-555555555555'
const OUTSIDER = '66666666-6666-4666-8666-666666666666'
const PROJECT = '77777777-7777-4777-8777-777777777777'
const LINK = '88888888-8888-4888-8888-888888888888'
const CARD_MESSAGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Row = Record<string, unknown>

/**
 * Enough EntityManager to answer `find` and `findOne` by entity and predicate.
 *
 * Every key in the query must equal the row's, and `{ $in: [...] }` is understood —
 * which is what makes the tenant and organization clauses the thing under test
 * rather than a detail the fake papers over.
 */
function fakeEm(rows: Map<unknown, Row[]>): EntityManager {
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && '$in' in (value as Row)) {
        return ((value as { $in: unknown[] }).$in ?? []).includes(row[key])
      }
      return row[key] === value
    })
  return {
    async findOne(entity: unknown, where: Row) {
      return (rows.get(entity) ?? []).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return (rows.get(entity) ?? []).filter((row) => matches(row, where))
    },
  } as unknown as EntityManager
}

function container(features: readonly string[]): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (name !== 'rbacService') throw new Error(`[internal] unexpected token ${name}`)
      return {
        async userHasAllFeatures(_userId: string, required: string[]) {
          return required.every((feature) => features.includes(feature))
        },
      }
    },
  } as unknown as AwilixContainer
}

function harness(options: { participants?: boolean; taskTenant?: string } = {}) {
  const rows = new Map<unknown, Row[]>()
  rows.set(
    ChatParticipant,
    options.participants === false
      ? []
      : [{ tenantId: TENANT, organizationId: ORG, conversationId: CONVERSATION, userId: USER, role: 'member' }],
  )
  rows.set(ChatConversation, [
    { tenantId: TENANT, organizationId: ORG, id: CONVERSATION, kind: 'direct', title: null, deletedAt: null },
  ])
  rows.set(ChatMessage, [])
  rows.set(ChatTaskLink, [
    {
      tenantId: TENANT,
      organizationId: ORG,
      id: LINK,
      conversationId: CONVERSATION,
      taskId: TASK,
      cardMessageId: CARD_MESSAGE,
      sourceMessageId: null,
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      deletedAt: null,
    },
  ])
  rows.set(TasksTask, [
    {
      tenantId: options.taskTenant ?? TENANT,
      organizationId: ORG,
      id: TASK,
      projectId: PROJECT,
      number: 42,
      title: 'Prepare the proposal',
      status: 'pending',
      priority: 'high',
      dueDate: null,
      dueTime: null,
      recurrenceFreq: null,
      recurrenceWeekday: null,
      recurrenceDayOfMonth: null,
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
      createdAt: new Date('2026-09-14T09:00:00.000Z'),
      deletedAt: null,
    },
  ])
  rows.set(TasksProject, [
    { tenantId: TENANT, organizationId: ORG, id: PROJECT, key: 'ENG', name: 'Engineering' },
  ])
  rows.set(TasksTaskAssignee, [])
  rows.set(TasksTaskAssignmentTarget, [])
  return rows
}

function ctx(rows: Map<unknown, Row[]>, features: readonly string[], userId = USER): ChatTaskReadContext {
  return {
    container: container(features),
    em: fakeEm(rows),
    scope: { tenantId: TENANT, organizationId: ORG },
    userId,
  }
}

const service = new DefaultChatTaskService()
const READER = ['chat.view', 'tasks.view']

describe('conversation access', () => {
  it('answers 404 for somebody who is not a participant', async () => {
    // Not 403. Telling a non-member that a conversation exists is exactly what an
    // id-guessing probe is looking for, and it is the rule chat itself follows.
    await expect(
      service.requireConversationAccess(ctx(harness({ participants: false }), READER), CONVERSATION),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('answers 404 for a participant row in another tenant', async () => {
    const rows = harness()
    rows.set(ChatParticipant, [
      { tenantId: OTHER_TENANT, organizationId: ORG, conversationId: CONVERSATION, userId: USER },
    ])
    await expect(
      service.requireConversationAccess(ctx(rows, READER), CONVERSATION),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('has no administrator bypass', async () => {
    // Chat access is membership, not privilege. Holding every grant in the product
    // must not open a conversation the holder was never added to.
    const everything = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign']
    await expect(
      service.requireConversationAccess(ctx(harness({ participants: false }), everything, OUTSIDER), CONVERSATION),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('per-viewer task hydration', () => {
  it('resolves a task for a viewer who may read tasks', async () => {
    const hydrated = await service.hydrateTasks(ctx(harness(), READER), [TASK])
    const task = hydrated.get(TASK)
    expect(task?.reference).toBe('ENG-42')
    expect(task?.title).toBe('Prepare the proposal')
    // The href points at a route the tasks module already serves, with the parameter
    // its own view reads — never a URL this module invented.
    expect(task?.href).toContain('/backend/tasks/all?task=')
  })

  it('resolves nothing at all for a viewer without the task grant', async () => {
    // A chat member with no task access. The short-circuit is what matters: not one
    // task row is read, so there is nothing to leak by accident.
    const hydrated = await service.hydrateTasks(ctx(harness(), ['chat.view']), [TASK])
    expect(hydrated.size).toBe(0)
  })

  it('resolves nothing for a task in another tenant', async () => {
    const hydrated = await service.hydrateTasks(ctx(harness({ taskTenant: OTHER_TENANT }), READER), [TASK])
    expect(hydrated.size).toBe(0)
  })

  it('reports canEdit from the edit grant, not from the read one', async () => {
    const readOnly = await service.hydrateTasks(ctx(harness(), READER), [TASK])
    expect(readOnly.get(TASK)?.canEdit).toBe(false)
    const editor = await service.hydrateTasks(ctx(harness(), [...READER, 'tasks.edit']), [TASK])
    expect(editor.get(TASK)?.canEdit).toBe(true)
  })
})

describe('cards in a transcript', () => {
  it('returns a full card for a viewer with both grants', async () => {
    const cards = await service.cardsForMessages(ctx(harness(), READER), CONVERSATION, [CARD_MESSAGE])
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ linkId: LINK, available: true })
    expect(cards[0]!.task?.title).toBe('Prepare the proposal')
  })

  /**
   * The security-critical shape. A chat member without task access must receive a
   * card that carries the link id and NOTHING else — no title, no assignee, no
   * project, no status, not even the task id.
   */
  it('returns an empty card for a chat member without task access', async () => {
    const cards = await service.cardsForMessages(ctx(harness(), ['chat.view']), CONVERSATION, [CARD_MESSAGE])
    expect(cards).toEqual([{ linkId: LINK, cardMessageId: CARD_MESSAGE, available: false, task: null }])
    const serialized = JSON.stringify(cards)
    for (const secret of ['Prepare the proposal', 'ENG-42', 'Engineering', 'pending', TASK]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('refuses the whole batch for a non-member before reading any link', async () => {
    await expect(
      service.cardsForMessages(ctx(harness({ participants: false }), READER), CONVERSATION, [CARD_MESSAGE]),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('ignores message ids that carry no card', async () => {
    const cards = await service.cardsForMessages(ctx(harness(), READER), CONVERSATION, [
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ])
    expect(cards).toEqual([])
  })
})

describe('source navigation', () => {
  it('lists the conversation for a viewer who is currently a member', async () => {
    const sources = await service.sourcesForTask(ctx(harness(), READER), TASK)
    expect(sources.items).toHaveLength(1)
    expect(sources.items[0]).toMatchObject({ conversationId: CONVERSATION, kind: 'direct' })
  })

  /**
   * The other half of the two-boundary rule: task access never grants chat access.
   * Somebody with every task grant sees an EMPTY list — not a count, not a masked
   * row — because saying "there is a conversation you may not read" already says one
   * exists.
   */
  it('omits every source for a task reader who is not in the conversation', async () => {
    const rows = harness({ participants: false })
    const sources = await service.sourcesForTask(ctx(rows, ['chat.view', 'tasks.view', 'tasks.edit'], OUTSIDER), TASK)
    expect(sources.items).toEqual([])
  })

  it('refuses a task the caller cannot read, so an id cannot be probed for links', async () => {
    await expect(
      service.sourcesForTask(ctx(harness(), ['chat.view']), TASK),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('drops a source message that has been deleted rather than linking to nothing', async () => {
    const rows = harness()
    const link = (rows.get(ChatTaskLink) ?? [])[0]!
    link.sourceMessageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    // No live ChatMessage row matches, so the reference is dropped.
    const sources = await service.sourcesForTask(ctx(rows, READER), TASK)
    expect(sources.items[0]?.messageId).toBeNull()
  })

  it('keeps a source message that is still live in this conversation', async () => {
    const rows = harness()
    const messageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    ;(rows.get(ChatTaskLink) ?? [])[0]!.sourceMessageId = messageId
    rows.set(ChatMessage, [
      { tenantId: TENANT, organizationId: ORG, id: messageId, conversationId: CONVERSATION, deletedAt: null },
    ])
    const sources = await service.sourcesForTask(ctx(rows, READER), TASK)
    expect(sources.items[0]?.messageId).toBe(messageId)
  })
})

describe('the conversation panel', () => {
  it('counts what the viewer cannot read without describing it', async () => {
    const page = await service.listConversationLinks(ctx(harness(), ['chat.view']), CONVERSATION, {
      state: 'all',
      assignedToMe: false,
      limit: 20,
    })
    expect(page.counts).toMatchObject({ open: 0, completed: 0, unavailable: 1 })
    expect(page.items).toEqual([
      { linkId: LINK, cardMessageId: CARD_MESSAGE, available: false, task: null },
    ])
  })

  it('filters an unavailable row out of the open and completed states', async () => {
    // `open` is a question about a task's status, and a task the reader cannot read
    // has no status they are entitled to know.
    const page = await service.listConversationLinks(ctx(harness(), ['chat.view']), CONVERSATION, {
      state: 'open',
      assignedToMe: false,
      limit: 20,
    })
    expect(page.items).toEqual([])
    expect(page.counts.unavailable).toBe(1)
  })

  it('counts an open task as open for a viewer who may read it', async () => {
    const page = await service.listConversationLinks(ctx(harness(), READER), CONVERSATION, {
      state: 'open',
      assignedToMe: false,
      limit: 20,
    })
    expect(page.items).toHaveLength(1)
    expect(page.counts).toMatchObject({ open: 1, completed: 0, unavailable: 0 })
  })
})
