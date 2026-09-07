import type { EntityManager } from '@mikro-orm/postgresql'
import { ChatConversation, ChatMessage, ChatParticipant } from '../data/entities'
import { DefaultChatService } from '../services/chatService'

jest.mock('../lib/messages', () => ({
  loadChatMessages: async () => ({
    conversationNotFound: 'Conversation not found',
    recipientNotFound: 'Recipient not found',
  }),
}))

jest.mock('../lib/scope', () => ({
  ...jest.requireActual('../lib/scope'),
  loadOrganizationMembers: jest.fn(async () => new Map()),
}))

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const ME = 'user-me'
const THEM = 'user-them'

type Row = Record<string, unknown>

/**
 * A stand-in `EntityManager` that records the `where` clause each `find` was
 * given. The point of these tests is not that MikroORM works — it is that every
 * read this service issues is scoped, so a query that quietly dropped
 * `tenantId` or `organizationId` fails here rather than in production.
 */
function fakeEm(tables: {
  participants?: Row[]
  conversations?: Row[]
  messages?: Row[]
}): { em: EntityManager; calls: Array<{ entity: unknown; where: Row }> } {
  const calls: Array<{ entity: unknown; where: Row }> = []

  const rowsFor = (entity: unknown): Row[] => {
    if (entity === ChatParticipant) return tables.participants ?? []
    if (entity === ChatConversation) return tables.conversations ?? []
    if (entity === ChatMessage) return tables.messages ?? []
    return []
  }

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (key === '$or') {
        return (expected as Row[]).some((clause) => matches(row, clause))
      }
      if (expected && typeof expected === 'object') {
        const operators = expected as Record<string, unknown>
        if ('$in' in operators) return (operators.$in as unknown[]).includes(row[key])
        if ('$ne' in operators) return row[key] !== operators.$ne
        if ('$gt' in operators) return (row[key] as Date) > (operators.$gt as Date)
        if ('$lt' in operators) return (row[key] as Date) < (operators.$lt as Date)
      }
      return row[key] === expected
    })

  /** Enough of MikroORM's `orderBy` to make ordering assertions mean something. */
  const sort = (rows: Row[], orderBy?: Record<string, 'asc' | 'desc'>): Row[] => {
    if (!orderBy) return rows
    const fields = Object.entries(orderBy)
    return [...rows].sort((left, right) => {
      for (const [field, direction] of fields) {
        const a = left[field] as string | number | Date
        const b = right[field] as string | number | Date
        if (a === b) continue
        const ascending = a < b ? -1 : 1
        return direction === 'desc' ? -ascending : ascending
      }
      return 0
    })
  }

  const em = {
    async find(entity: unknown, where: Row, options?: { orderBy?: Record<string, 'asc' | 'desc'>; limit?: number }) {
      calls.push({ entity, where })
      const matched = sort(rowsFor(entity).filter((row) => matches(row, where)), options?.orderBy)
      return typeof options?.limit === 'number' ? matched.slice(0, options.limit) : matched
    },
    async findOne(entity: unknown, where: Row) {
      calls.push({ entity, where })
      return rowsFor(entity).find((row) => matches(row, where)) ?? null
    },
  } as unknown as EntityManager

  return { em, calls }
}

function participant(overrides: Row = {}): Row {
  return {
    id: 'p-1',
    ...SCOPE,
    conversationId: 'conv-1',
    userId: ME,
    lastReadAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

function conversation(overrides: Row = {}): Row {
  return {
    id: 'conv-1',
    ...SCOPE,
    kind: 'direct',
    directKey: `${ME}:${THEM}`,
    lastMessageAt: new Date('2026-09-02T10:00:00Z'),
    lastMessagePreview: 'hello',
    lastMessageSenderUserId: THEM,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

function message(overrides: Row = {}): Row {
  return {
    id: 'msg-1',
    ...SCOPE,
    conversationId: 'conv-1',
    senderUserId: THEM,
    body: 'hello',
    clientMessageId: null,
    createdAt: new Date('2026-09-02T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

const ctx = (em: EntityManager) => ({ em, scope: SCOPE, userId: ME })

describe('requireParticipant', () => {
  it('returns the caller’s membership row when they belong to the conversation', async () => {
    const { em } = fakeEm({ participants: [participant()], conversations: [conversation()] })
    // Returns both rows so callers do not re-query the conversation.
    await expect(new DefaultChatService().requireParticipant(ctx(em), 'conv-1')).resolves.toMatchObject({
      participant: { userId: ME },
      conversation: { id: 'conv-1' },
    })
  })

  it('refuses a conversation the caller is not a participant of', async () => {
    const { em } = fakeEm({
      participants: [participant({ userId: THEM })],
      conversations: [conversation()],
    })
    await expect(new DefaultChatService().requireParticipant(ctx(em), 'conv-1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('refuses a conversation belonging to another organization', async () => {
    const { em } = fakeEm({
      participants: [participant({ organizationId: 'org-2' })],
      conversations: [conversation({ organizationId: 'org-2' })],
    })
    await expect(new DefaultChatService().requireParticipant(ctx(em), 'conv-1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('refuses a conversation belonging to another tenant', async () => {
    const { em } = fakeEm({
      participants: [participant({ tenantId: 'tenant-2' })],
      conversations: [conversation({ tenantId: 'tenant-2' })],
    })
    await expect(new DefaultChatService().requireParticipant(ctx(em), 'conv-1')).rejects.toMatchObject({
      status: 404,
    })
  })

  /**
   * A membership row that outlived its conversation must not keep it readable —
   * otherwise a soft delete would be cosmetic.
   */
  it('refuses when the conversation is soft-deleted but the membership row remains', async () => {
    const { em } = fakeEm({
      participants: [participant()],
      conversations: [conversation({ deletedAt: new Date() })],
    })
    await expect(new DefaultChatService().requireParticipant(ctx(em), 'conv-1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('answers 404 rather than 403, so an id probe learns nothing', async () => {
    const { em } = fakeEm({ participants: [], conversations: [] })
    await expect(
      new DefaultChatService().requireParticipant(ctx(em), 'conv-does-not-exist'),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('listMessages', () => {
  const service = new DefaultChatService()

  it('scopes every message read by tenant, organization and conversation', async () => {
    const { em, calls } = fakeEm({
      participants: [participant()],
      conversations: [conversation()],
      messages: [message()],
    })
    await service.listMessages(ctx(em), 'conv-1', {})

    const messageQuery = calls.find((call) => call.entity === ChatMessage)
    expect(messageQuery?.where).toMatchObject({
      conversationId: 'conv-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      deletedAt: null,
    })
  })

  it('returns messages oldest-first for rendering', async () => {
    const { em } = fakeEm({
      participants: [participant()],
      conversations: [conversation()],
      messages: [
        message({ id: 'm1', createdAt: new Date('2026-09-02T10:00:00Z') }),
        message({ id: 'm2', createdAt: new Date('2026-09-02T11:00:00Z') }),
      ],
    })
    const page = await service.listMessages(ctx(em), 'conv-1', {})
    expect(page.items.map((item) => item.id)).toEqual(['m1', 'm2'])
  })

  it('refuses to read messages of a conversation the caller is not in', async () => {
    const { em } = fakeEm({
      participants: [participant({ userId: THEM })],
      conversations: [conversation()],
      messages: [message()],
    })
    await expect(service.listMessages(ctx(em), 'conv-1', {})).rejects.toMatchObject({ status: 404 })
  })
})

/**
 * `countUnread` and the per-conversation unread aggregate are deliberately NOT
 * unit-tested here.
 *
 * They are a Kysely `GROUP BY` over a join — the database evaluates the read
 * cursor per row rather than the service loading rows to count them. A fake
 * EntityManager cannot execute that, and a hand-written stand-in would only
 * assert the behaviour of the stand-in. The real assertions live in
 * `__integration__/TC-CHAT-001-direct-messaging.spec.ts`, which runs the query
 * against Postgres.
 */
