import handle from '../subscribers/message-notification'
import { ChatConversation, ChatMessage, ChatMessageMention, ChatParticipant } from '../data/entities'

/**
 * Who gets told is the entire policy, so that is what this asserts.
 *
 * The notifications module is stubbed: its own delivery, preference and push
 * behaviour are its tests' business. What belongs here is the decision chat
 * makes before handing anything over — a direct notifies its counterpart, a
 * space notifies only the people it names, and three exclusions apply on top.
 */
const created: Array<Record<string, unknown>> = []

jest.mock('../../notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({
    async create(input: Record<string, unknown>) {
      created.push(input)
    },
  }),
}))

jest.mock('../../notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: (type: { type: string }, input: Record<string, unknown>) => ({
    type: type.type,
    ...input,
  }),
}))

jest.mock('../lib/scope', () => ({
  loadOrganizationMember: async () => ({ id: 'sender', name: 'Bao Nguyen' }),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const MESSAGE = '44444444-4444-4444-8444-444444444444'
const SENDER = '55555555-5555-4555-8555-555555555555'
const ALICE = '66666666-6666-4666-8666-666666666666'
const BOB = '77777777-7777-4777-8777-777777777777'

const SENT_AT = new Date('2026-09-13T12:00:00.000Z')

type Row = Record<string, unknown>

/** Just enough EntityManager for the two lookups and two collection reads. */
function fakeEm(rows: Map<unknown, Row[]>) {
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => value === undefined || row[key] === value)
  const em = {
    fork: () => em,
    async findOne(entity: unknown, where: Row) {
      return (rows.get(entity) ?? []).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return (rows.get(entity) ?? []).filter((row) => matches(row, where))
    },
  }
  return em
}

function scenario(options: {
  kind?: 'direct' | 'space'
  mentionsEveryone?: boolean
  mentioned?: string[]
  participants?: Array<{ userId: string; mutedAt?: Date | null; lastReadAt?: Date | null }>
  messageKind?: string
  deletedAt?: Date | null
}) {
  created.length = 0
  const rows = new Map<unknown, Row[]>()
  rows.set(ChatMessage, [
    {
      id: MESSAGE,
      tenantId: TENANT,
      organizationId: ORG,
      kind: options.messageKind ?? 'user',
      deletedAt: options.deletedAt ?? null,
      createdAt: SENT_AT,
      mentionsEveryone: Boolean(options.mentionsEveryone),
    },
  ])
  rows.set(ChatConversation, [
    {
      id: CONVERSATION,
      tenantId: TENANT,
      organizationId: ORG,
      kind: options.kind ?? 'direct',
      title: options.kind === 'space' ? 'Launch' : null,
    },
  ])
  rows.set(
    ChatParticipant,
    (options.participants ?? [{ userId: SENDER }, { userId: ALICE }]).map((participant) => ({
      conversationId: CONVERSATION,
      tenantId: TENANT,
      organizationId: ORG,
      mutedAt: null,
      lastReadAt: null,
      ...participant,
    })),
  )
  rows.set(
    ChatMessageMention,
    (options.mentioned ?? []).map((userId) => ({
      messageId: MESSAGE,
      tenantId: TENANT,
      organizationId: ORG,
      mentionedUserId: userId,
    })),
  )

  const em = fakeEm(rows)
  const ctx = {
    resolve: <T,>(name: string) => (name === 'em' ? (em as unknown as T) : (undefined as T)),
    container: { resolve: <T,>(name: string) => (name === 'em' ? (em as unknown as T) : (undefined as T)) },
    tenantId: TENANT,
    organizationId: ORG,
  }
  const payload = {
    conversationId: CONVERSATION,
    messageId: MESSAGE,
    senderUserId: SENDER,
    createdAt: SENT_AT.toISOString(),
  }
  return { ctx, payload }
}

const recipients = () => created.map((one) => one.recipientUserId).sort()

describe('a direct message', () => {
  it('notifies the counterpart', async () => {
    const { ctx, payload } = scenario({})
    await handle(payload, ctx as never)
    expect(recipients()).toEqual([ALICE])
    expect(created[0].type).toBe('chat.direct.received')
  })

  it('never notifies the sender about their own message', async () => {
    const { ctx, payload } = scenario({})
    await handle(payload, ctx as never)
    expect(recipients()).not.toContain(SENDER)
  })
})

describe('a space message', () => {
  /**
   * The rule the whole design turns on. One row per member per message is the
   * noise the read-cursor unread model exists to avoid.
   */
  it('notifies nobody when it names nobody', async () => {
    const { ctx, payload } = scenario({
      kind: 'space',
      participants: [{ userId: SENDER }, { userId: ALICE }, { userId: BOB }],
    })
    await handle(payload, ctx as never)
    expect(created).toHaveLength(0)
  })

  it('notifies only the people it names', async () => {
    const { ctx, payload } = scenario({
      kind: 'space',
      mentioned: [ALICE],
      participants: [{ userId: SENDER }, { userId: ALICE }, { userId: BOB }],
    })
    await handle(payload, ctx as never)
    expect(recipients()).toEqual([ALICE])
    expect(created[0].type).toBe('chat.mention.received')
  })

  it('notifies everyone for @everyone, still minus the sender', async () => {
    const { ctx, payload } = scenario({
      kind: 'space',
      mentionsEveryone: true,
      participants: [{ userId: SENDER }, { userId: ALICE }, { userId: BOB }],
    })
    await handle(payload, ctx as never)
    expect(recipients()).toEqual([ALICE, BOB].sort())
  })
})

describe('exclusions', () => {
  it('says nothing to somebody who muted the conversation', async () => {
    const { ctx, payload } = scenario({
      participants: [{ userId: SENDER }, { userId: ALICE, mutedAt: new Date() }],
    })
    await handle(payload, ctx as never)
    expect(created).toHaveLength(0)
  })

  it('says nothing to somebody whose cursor is already past it', async () => {
    // They had the conversation open as it arrived.
    const { ctx, payload } = scenario({
      participants: [{ userId: SENDER }, { userId: ALICE, lastReadAt: new Date(SENT_AT.getTime() + 1) }],
    })
    await handle(payload, ctx as never)
    expect(created).toHaveLength(0)
  })

  it('still notifies somebody whose cursor is behind it', async () => {
    const { ctx, payload } = scenario({
      participants: [{ userId: SENDER }, { userId: ALICE, lastReadAt: new Date(SENT_AT.getTime() - 1) }],
    })
    await handle(payload, ctx as never)
    expect(recipients()).toEqual([ALICE])
  })

  it('ignores a system row, which is not something anybody said', async () => {
    const { ctx, payload } = scenario({ messageKind: 'system' })
    await handle(payload, ctx as never)
    expect(created).toHaveLength(0)
  })

  it('ignores a message that has been deleted', async () => {
    const { ctx, payload } = scenario({ deletedAt: new Date() })
    await handle(payload, ctx as never)
    expect(created).toHaveLength(0)
  })
})

describe('the payload it is given', () => {
  it('groups by conversation and reader, so five messages leave one entry', async () => {
    const { ctx, payload } = scenario({})
    await handle(payload, ctx as never)
    expect(created[0].groupKey).toBe(`chat.direct.received:${CONVERSATION}:${ALICE}`)
  })

  it('links to the conversation, not to the message', async () => {
    const { ctx, payload } = scenario({})
    await handle(payload, ctx as never)
    expect(created[0].linkHref).toBe(`/backend/chat/${CONVERSATION}`)
    expect(created[0].sourceEntityId).toBe(CONVERSATION)
  })

  it('names the sender in the body', async () => {
    const { ctx, payload } = scenario({})
    await handle(payload, ctx as never)
    expect((created[0].bodyVariables as Record<string, unknown>).sender).toBe('Bao Nguyen')
  })
})

describe('when something is missing', () => {
  it.each([
    ['no conversation', { conversationId: undefined }],
    ['no message', { messageId: undefined }],
    ['no sender', { senderUserId: undefined }],
  ])('does nothing with %s', async (_label, overrides) => {
    const { ctx, payload } = scenario({})
    await handle({ ...payload, ...overrides }, ctx as never)
    expect(created).toHaveLength(0)
  })

  it('swallows a failure rather than retrying a notification for a visible message', async () => {
    const { payload } = scenario({})
    const broken = {
      resolve: () => {
        throw new Error('no container')
      },
      tenantId: TENANT,
      organizationId: ORG,
    }
    await expect(handle(payload, broken as never)).resolves.toBeUndefined()
  })
})
