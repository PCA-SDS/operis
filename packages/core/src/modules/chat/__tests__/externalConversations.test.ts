import { randomUUID } from 'node:crypto'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { ChatConversation, ChatExternalContact, ChatParticipant } from '../data/entities'
import '../commands/externalConversations'

/**
 * The four commands that are the only way an outsider becomes a participant.
 * Each is run as the transport runs it — a context with no logged-in user — and
 * each refuses one that has one.
 */

const mockEmit = jest.fn()
const mockAudience = jest.fn()
const mockMembers = jest.fn()

jest.mock('../commands/shared', () => ({
  ...jest.requireActual('../commands/shared'),
  emitConversationEvent: (...args: unknown[]) => mockEmit(...args),
  conversationAudience: (...args: unknown[]) => mockAudience(...args),
}))
jest.mock('../lib/scope', () => ({
  ...jest.requireActual('../lib/scope'),
  loadOrganizationMembers: (...args: unknown[]) => mockMembers(...args),
}))
jest.mock('../lib/clock', () => ({
  ...jest.requireActual('../lib/clock'),
  dbNow: async () => new Date('2026-09-29T12:00:00.000Z'),
}))
jest.mock('../lib/messages', () => ({
  ...jest.requireActual('../lib/messages'),
  loadChatMessages: async () => ({ conversationNotFound: 'Conversation not found' }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: (em: FakeEm, entity: unknown, where: Row) => em.findOne(entity, where),
  findWithDecryption: (em: FakeEm, entity: unknown, where: Row) => em.find(entity, where),
}))

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const CONTACT = '66666666-6666-4666-8666-666666666666'
const ALICE = '55555555-5555-4555-8555-555555555555'
const BOB = '77777777-7777-4777-8777-777777777777'

type Row = Record<string, unknown>

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(row[key])
    // SQL's `is null`: an unset column is null too.
    if (value === null) return row[key] === null || row[key] === undefined
    return row[key] === value
  })
}

/** An EntityManager that stores rows by entity, and can lose one insert race on demand. */
class FakeEm {
  readonly rows = new Map<unknown, Row[]>()
  flushes = 0
  private pending: Row[] = []
  private race: { winner: { entity: unknown; row: Row } | null } | null = null

  seed(entity: unknown, row: Row): Row {
    const bucket = this.rows.get(entity) ?? []
    bucket.push(row)
    this.rows.set(entity, bucket)
    return row
  }

  rowsOf(entity: unknown): Row[] {
    return [...(this.rows.get(entity) ?? [])]
  }

  /** The next flush fails with a unique violation; `winner` is what the other writer stored. */
  loseNextInsert(winner: { entity: unknown; row: Row } | null): void {
    this.race = { winner }
  }

  fork(): FakeEm {
    return this
  }

  async findOne(entity: unknown, where: Row): Promise<Row | null> {
    return this.rowsOf(entity).find((row) => matches(row, where)) ?? null
  }

  async find(entity: unknown, where: Row): Promise<Row[]> {
    return this.rowsOf(entity).filter((row) => matches(row, where))
  }

  create(entity: unknown, data: Row): Row {
    return { id: randomUUID(), ...data, __entity: entity }
  }

  persist(row: Row): void {
    this.pending.push(row)
  }

  async flush(): Promise<void> {
    this.flushes += 1
    if (this.race) {
      const { winner } = this.race
      this.race = null
      this.pending = []
      if (winner) this.seed(winner.entity, winner.row)
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    }
    for (const row of this.pending) {
      if (!this.rowsOf(row.__entity).includes(row)) this.seed(row.__entity, row)
    }
    this.pending = []
  }

  async transactional<T>(work: (tx: FakeEm) => Promise<T>): Promise<T> {
    return work(this)
  }
}

function contextFor(em: FakeEm, options: { sub?: string } = {}): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`unregistered ${name}`)
      },
    },
    auth: { tenantId: scope.tenantId, orgId: scope.organizationId, ...(options.sub ? { sub: options.sub } : {}) },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  } as unknown as CommandRuntimeContext
}

async function run<T>(commandId: string, em: FakeEm, input: Row, options: { sub?: string } = {}): Promise<T> {
  const handler = commandRegistry.get<Row, T>(commandId)
  if (!handler) throw new Error(`command ${commandId} is not registered`)
  return handler.execute({ ...scope, ...input }, contextFor(em, options))
}

function seedContact(em: FakeEm, overrides: Row = {}): Row {
  return em.seed(ChatExternalContact, {
    ...scope,
    id: CONTACT,
    network: 'whatsapp',
    displayName: 'Linh Tran',
    ...overrides,
  })
}

function seedConversation(em: FakeEm, kind: string, overrides: Row = {}): Row {
  return em.seed(ChatConversation, { ...scope, id: CONVERSATION, kind, deletedAt: null, ...overrides })
}

beforeEach(() => {
  mockEmit.mockReset()
  mockAudience.mockReset()
  mockAudience.mockResolvedValue([ALICE])
  mockMembers.mockReset()
  mockMembers.mockImplementation(async (_em: unknown, _scope: unknown, ids: string[]) => new Map(ids.map((id) => [id, { id }])))
})

describe('a logged-in user cannot run any of them', () => {
  it.each([
    ['chat.externalContacts.ensure', { id: CONTACT, network: 'whatsapp', displayName: 'Linh Tran' }],
    ['chat.conversations.createExternal', { externalContactIds: [CONTACT], memberUserIds: [ALICE] }],
    ['chat.conversations.addExternalParticipant', { conversationId: CONVERSATION, externalContactId: CONTACT }],
    ['chat.conversations.closeExternal', { conversationId: CONVERSATION }],
  ])('%s refuses a session', async (commandId, input) => {
    const em = new FakeEm()
    seedContact(em)
    seedConversation(em, 'external')
    await expect(run(commandId, em, input, { sub: ALICE })).rejects.toMatchObject({ status: 403 })
    expect(em.flushes).toBe(0)
  })
})

describe('chat.externalContacts.ensure', () => {
  it('records a newcomer in this organization', async () => {
    const em = new FakeEm()
    await expect(
      run('chat.externalContacts.ensure', em, { id: CONTACT, network: 'whatsapp', displayName: '  Linh Tran  ' }),
    ).resolves.toEqual({ id: CONTACT, created: true })
    expect(em.rowsOf(ChatExternalContact)).toEqual([
      expect.objectContaining({ ...scope, id: CONTACT, network: 'whatsapp', displayName: 'Linh Tran' }),
    ])
  })

  it('writes nothing for a contact it already knows by that name', async () => {
    const em = new FakeEm()
    seedContact(em)
    await expect(
      run('chat.externalContacts.ensure', em, { id: CONTACT, network: 'whatsapp', displayName: 'Linh Tran' }),
    ).resolves.toEqual({ id: CONTACT, created: false })
    expect(em.flushes).toBe(0)
  })

  it('keeps the number the network revealed, and only a real E.164 one', async () => {
    const em = new FakeEm()
    await run('chat.externalContacts.ensure', em, {
      id: CONTACT,
      network: 'whatsapp',
      displayName: 'Linh Tran',
      handle: '+4915123456789',
    })
    expect(em.rowsOf(ChatExternalContact)[0]).toMatchObject({ handle: '+4915123456789' })

    const other = new FakeEm()
    await run('chat.externalContacts.ensure', other, {
      id: CONTACT,
      network: 'whatsapp',
      displayName: 'Linh Tran',
      handle: '0151 2345',
    })
    expect(other.rowsOf(ChatExternalContact)[0]).toMatchObject({ handle: null })
  })

  it('keeps a known number when this sighting does not reveal one', async () => {
    const em = new FakeEm()
    const contact = seedContact(em, { handle: '+4915123456789' })
    await run('chat.externalContacts.ensure', em, { id: CONTACT, network: 'whatsapp', displayName: 'Linh Tran' })
    expect(contact.handle).toBe('+4915123456789')
    expect(em.flushes).toBe(0)
  })

  it('refreshes a name the bridge changed', async () => {
    const em = new FakeEm()
    const contact = seedContact(em)
    await run('chat.externalContacts.ensure', em, { id: CONTACT, network: 'whatsapp', displayName: 'Linh T.' })
    expect(contact.displayName).toBe('Linh T.')
    expect(em.flushes).toBe(1)
  })

  it.each([
    ['a network that is not a lowercase label', { network: 'WhatsApp', displayName: 'Linh' }],
    ['an empty name', { network: 'whatsapp', displayName: '   ' }],
  ])('refuses %s', async (_label, input) => {
    const em = new FakeEm()
    await expect(run('chat.externalContacts.ensure', em, { id: CONTACT, ...input })).rejects.toMatchObject({
      status: 400,
    })
    expect(em.rowsOf(ChatExternalContact)).toEqual([])
  })

  it('converges when push and poll insert the same newcomer at once', async () => {
    const em = new FakeEm()
    em.loseNextInsert({
      entity: ChatExternalContact,
      row: { ...scope, id: CONTACT, network: 'whatsapp', displayName: 'Linh Tran' },
    })
    await expect(
      run('chat.externalContacts.ensure', em, { id: CONTACT, network: 'whatsapp', displayName: 'Linh Tran' }),
    ).resolves.toEqual({ id: CONTACT, created: false })
  })

  it("never adopts an id that belongs to another organization's contact", async () => {
    // The insert collides, and the re-read in this scope finds nothing to reuse.
    const em = new FakeEm()
    em.loseNextInsert({
      entity: ChatExternalContact,
      row: { ...scope, organizationId: OTHER_ORG, id: CONTACT, network: 'whatsapp', displayName: 'Someone else' },
    })
    await expect(
      run('chat.externalContacts.ensure', em, { id: CONTACT, network: 'whatsapp', displayName: 'Linh Tran' }),
    ).rejects.toMatchObject({ code: '23505' })
  })
})

describe('chat.conversations.createExternal', () => {
  it('seats the colleagues and the outsiders, and tells only the colleagues', async () => {
    const em = new FakeEm()
    seedContact(em)
    const { conversationId } = await run<{ conversationId: string }>('chat.conversations.createExternal', em, {
      title: '  Supplier  ',
      externalContactIds: [CONTACT, CONTACT],
      memberUserIds: [ALICE, BOB],
    })

    expect(em.rowsOf(ChatConversation)).toEqual([
      expect.objectContaining({ ...scope, id: conversationId, kind: 'external', title: 'Supplier' }),
    ])
    const seats = em.rowsOf(ChatParticipant).map((row) => ({
      userId: row.userId,
      externalContactId: row.externalContactId ?? null,
      conversationKind: row.conversationKind ?? null,
    }))
    expect(seats).toEqual([
      { userId: ALICE, externalContactId: null, conversationKind: null },
      { userId: BOB, externalContactId: null, conversationKind: null },
      { userId: null, externalContactId: CONTACT, conversationKind: 'external' },
    ])
    expect(mockEmit).toHaveBeenCalledWith('chat.conversation.created', scope, [ALICE, BOB], { conversationId })
  })

  it("refuses a contact this organization does not know, even one another organization does", async () => {
    const em = new FakeEm()
    seedContact(em, { organizationId: OTHER_ORG })
    await expect(
      run('chat.conversations.createExternal', em, { externalContactIds: [CONTACT], memberUserIds: [ALICE] }),
    ).rejects.toMatchObject({ status: 404 })
    expect(em.rowsOf(ChatConversation)).toEqual([])
  })

  it('refuses a colleague who is not an active member', async () => {
    const em = new FakeEm()
    seedContact(em)
    mockMembers.mockResolvedValue(new Map([[ALICE, { id: ALICE }]]))
    await expect(
      run('chat.conversations.createExternal', em, { externalContactIds: [CONTACT], memberUserIds: [ALICE, BOB] }),
    ).rejects.toMatchObject({ status: 400 })
    expect(em.rowsOf(ChatConversation)).toEqual([])
  })

  it.each([
    ['no outsider', { externalContactIds: [], memberUserIds: [ALICE] }],
    ['no colleague to read it', { externalContactIds: [CONTACT], memberUserIds: [] }],
  ])('refuses a conversation with %s', async (_label, input) => {
    const em = new FakeEm()
    seedContact(em)
    await expect(run('chat.conversations.createExternal', em, input)).rejects.toMatchObject({ status: 400 })
  })
})

describe('chat.conversations.addExternalParticipant', () => {
  it('seats a newcomer once, however often they are seen', async () => {
    const em = new FakeEm()
    seedContact(em)
    seedConversation(em, 'external')

    const input = { conversationId: CONVERSATION, externalContactId: CONTACT }
    await expect(run('chat.conversations.addExternalParticipant', em, input)).resolves.toEqual({ added: true })
    await expect(run('chat.conversations.addExternalParticipant', em, input)).resolves.toEqual({ added: false })

    expect(em.rowsOf(ChatParticipant)).toEqual([
      expect.objectContaining({ userId: null, externalContactId: CONTACT, conversationKind: 'external' }),
    ])
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith('chat.conversation.updated', scope, [ALICE], {
      conversationId: CONVERSATION,
      change: 'external_participant_added',
    })
  })

  it.each(['direct', 'space'])('refuses a %s', async (kind) => {
    const em = new FakeEm()
    seedContact(em)
    seedConversation(em, kind)
    await expect(
      run('chat.conversations.addExternalParticipant', em, { conversationId: CONVERSATION, externalContactId: CONTACT }),
    ).rejects.toMatchObject({ status: 404 })
    expect(em.rowsOf(ChatParticipant)).toEqual([])
  })

  it('refuses a contact from another organization', async () => {
    const em = new FakeEm()
    seedContact(em, { organizationId: OTHER_ORG })
    seedConversation(em, 'external')
    await expect(
      run('chat.conversations.addExternalParticipant', em, { conversationId: CONVERSATION, externalContactId: CONTACT }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a closed conversation', async () => {
    const em = new FakeEm()
    seedContact(em)
    seedConversation(em, 'external', { deletedAt: new Date('2026-09-29T11:00:00.000Z') })
    await expect(
      run('chat.conversations.addExternalParticipant', em, { conversationId: CONVERSATION, externalContactId: CONTACT }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('chat.conversations.closeExternal', () => {
  it('closes it and tells whoever was in it', async () => {
    const em = new FakeEm()
    const conversation = seedConversation(em, 'external')
    await expect(run('chat.conversations.closeExternal', em, { conversationId: CONVERSATION })).resolves.toEqual({
      closed: true,
    })
    expect(conversation.deletedAt).toEqual(new Date('2026-09-29T12:00:00.000Z'))
    expect(mockEmit).toHaveBeenCalledWith('chat.conversation.updated', scope, [ALICE], {
      conversationId: CONVERSATION,
      change: 'closed',
    })
  })

  it('converges when it is already closed', async () => {
    const em = new FakeEm()
    seedConversation(em, 'external', { deletedAt: new Date('2026-09-29T11:00:00.000Z') })
    await expect(run('chat.conversations.closeExternal', em, { conversationId: CONVERSATION })).resolves.toEqual({
      closed: false,
    })
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('refuses to close a space', async () => {
    const em = new FakeEm()
    const space = seedConversation(em, 'space')
    await expect(run('chat.conversations.closeExternal', em, { conversationId: CONVERSATION })).rejects.toMatchObject({
      status: 404,
    })
    expect(space.deletedAt).toBeNull()
  })
})
