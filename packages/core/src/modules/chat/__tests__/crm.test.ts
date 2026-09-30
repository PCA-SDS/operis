import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { ChatConversation, ChatExternalContact, ChatParticipant } from '../data/entities'
import type { ChatExternalMemberDto, ChatMemberListDto } from '../data/types'
import { customerRef, withCrm } from '../lib/crm'
import '../commands/crm'

/**
 * The CRM as chat sees it: an optional peer found through DI, whose records a
 * colleague sees only as far as the CRM's own permissions go, and which only a
 * colleague who can answer the client may link an outsider to.
 */

const mockEmit = jest.fn()

jest.mock('../commands/shared', () => ({
  ...jest.requireActual('../commands/shared'),
  emitConversationEvent: (...args: unknown[]) => mockEmit(...args),
  conversationAudience: async () => [],
}))
jest.mock('../lib/clock', () => ({
  ...jest.requireActual('../lib/clock'),
  dbNow: async () => new Date('2026-09-30T12:00:00.000Z'),
}))
jest.mock('../lib/messages', () => ({
  ...jest.requireActual('../lib/messages'),
  loadChatMessages: async () => new Proxy({}, { get: (_target, key) => String(key) }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: (em: FakeEm, entity: unknown, where: Row) => em.findOne(entity, where),
  findWithDecryption: (em: FakeEm, entity: unknown, where: Row) => em.find(entity, where),
}))
jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: async () => ({ matched: false, reason: 'search-disabled' }),
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
const PERSON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FOREIGN_PERSON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/** Stands in for the class `customers` registers as `CustomerEntity`. */
const CustomerEntity = { name: 'CustomerEntity' }

type Row = Record<string, unknown>

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in expected) return (expected.$in as unknown[]).includes(actual)
  if (expected && typeof expected === 'object' && '$ne' in expected) {
    const other = (expected as { $ne: unknown }).$ne
    return other === null ? actual !== null && actual !== undefined : actual !== other
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === '$or') return (value as Row[]).some((branch) => matches(row, branch))
    return matchesValue(row[key], value)
  })
}

class FakeEm {
  readonly rows = new Map<unknown, Row[]>()

  seed(entity: unknown, row: Row): Row {
    this.rows.set(entity, [...(this.rows.get(entity) ?? []), row])
    return row
  }

  rowsOf(entity: unknown): Row[] {
    return [...(this.rows.get(entity) ?? [])]
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

  async flush(): Promise<void> {}
}

function container(options: { crm?: boolean; features?: string[] } = {}) {
  const features = new Set(options.features ?? ['customers.people.view', 'customers.companies.view'])
  return {
    resolve: (name: string) => {
      if (name === 'CustomerEntity' && options.crm !== false) return CustomerEntity
      if (name === 'rbacService') {
        return { userHasAllFeatures: async (_user: string, wanted: string[]) => wanted.every((f) => features.has(f)) }
      }
      if (name === 'em') throw new Error('em is passed explicitly in these tests')
      throw new Error(`unregistered ${name}`)
    },
  }
}

function seedCrm(em: FakeEm): void {
  const phoneHash = hashForLookup('4915123456789', 'customers:customer_entity:primary_phone')
  em.seed(CustomerEntity, { ...scope, id: PERSON, kind: 'person', displayName: 'Linh Tran', primaryPhoneHash: phoneHash, deletedAt: null })
  em.seed(CustomerEntity, { ...scope, id: COMPANY, kind: 'company', displayName: 'Tran Trading', deletedAt: null })
  em.seed(CustomerEntity, {
    ...scope,
    organizationId: OTHER_ORG,
    id: FOREIGN_PERSON,
    kind: 'person',
    displayName: 'Somebody Else',
    primaryPhoneHash: phoneHash,
    deletedAt: null,
  })
}

function outsider(overrides: Partial<ChatExternalMemberDto> = {}): ChatExternalMemberDto {
  return {
    id: CONTACT,
    name: 'Linh',
    network: 'whatsapp',
    handle: null,
    joinedAt: '2026-09-30T10:00:00.000Z',
    customer: null,
    suggestion: null,
    ...overrides,
  }
}

function list(externalMembers: ChatExternalMemberDto[]): ChatMemberListDto {
  return { items: [], total: 0, hasMore: false, externalMembers, crm: { available: false, canLink: false } }
}

const participantViewer = { userId: ALICE, access: 'participant' as const, external: true }

describe('what a colleague sees of the CRM', () => {
  it('shows no CRM at all when customers is not installed', async () => {
    const em = new FakeEm()
    const result = await withCrm(em as unknown as EntityManager, container({ crm: false }), scope, participantViewer, list([outsider()]))
    expect(result.crm).toEqual({ available: false, canLink: false })
    expect(result.externalMembers[0]).toMatchObject({ customer: null, suggestion: null })
  })

  it('names a linked record the viewer may open, and only says there is one otherwise', async () => {
    const em = new FakeEm()
    seedCrm(em)
    const members = [
      outsider({ customer: { id: PERSON, kind: null, name: null, href: null } }),
      outsider({ id: randomUUID(), customer: { id: COMPANY, kind: null, name: null, href: null } }),
    ]
    const result = await withCrm(
      em as unknown as EntityManager,
      container({ features: ['customers.people.view'] }),
      scope,
      participantViewer,
      list(members),
    )
    expect(result.externalMembers[0].customer).toEqual({
      id: PERSON,
      kind: 'person',
      name: 'Linh Tran',
      href: `/backend/customers/people-v2/${PERSON}`,
    })
    expect(result.externalMembers[1].customer).toEqual({ id: COMPANY, kind: null, name: null, href: null })
  })

  it('suggests the CRM person with their number, from this organization only', async () => {
    const em = new FakeEm()
    seedCrm(em)
    const result = await withCrm(
      em as unknown as EntityManager,
      container(),
      scope,
      participantViewer,
      list([outsider({ handle: '+4915123456789' })]),
    )
    expect(result.externalMembers[0].suggestion).toMatchObject({ id: PERSON, name: 'Linh Tran' })
    expect(result.crm).toEqual({ available: true, canLink: true })
  })

  it('suggests nobody to a viewer who may not open people', async () => {
    const em = new FakeEm()
    seedCrm(em)
    const result = await withCrm(
      em as unknown as EntityManager,
      container({ features: ['customers.companies.view'] }),
      scope,
      participantViewer,
      list([outsider({ handle: '+4915123456789' })]),
    )
    expect(result.externalMembers[0].suggestion).toBeNull()
  })

  it('lets only a colleague who can answer the client link', async () => {
    const em = new FakeEm()
    const viewer = await withCrm(em as unknown as EntityManager, container(), scope, { ...participantViewer, access: 'viewer' }, list([]))
    const noCrmRights = await withCrm(em as unknown as EntityManager, container({ features: [] }), scope, participantViewer, list([]))
    expect(viewer.crm.canLink).toBe(false)
    expect(noCrmRights.crm.canLink).toBe(false)
  })

  it('hides a record that is gone the same way as one the viewer may not open', () => {
    expect(customerRef(PERSON, undefined, new Set(['person']))).toEqual({ id: PERSON, kind: null, name: null, href: null })
  })
})

function commandContext(em: FakeEm, sub: string, options: { crm?: boolean; features?: string[] } = {}): CommandRuntimeContext {
  const peers = container(options)
  return {
    container: {
      resolve: (name: string) => (name === 'em' ? em : peers.resolve(name)),
    },
    auth: { tenantId: scope.tenantId, orgId: scope.organizationId, sub },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  } as unknown as CommandRuntimeContext
}

function seedConversation(em: FakeEm, seats: Array<[string, string]>): Row {
  em.seed(ChatConversation, { ...scope, id: CONVERSATION, kind: 'external', deletedAt: null })
  for (const [userId, access] of seats) {
    em.seed(ChatParticipant, { ...scope, id: randomUUID(), conversationId: CONVERSATION, userId, role: 'member', access })
  }
  em.seed(ChatParticipant, { ...scope, id: randomUUID(), conversationId: CONVERSATION, userId: null, externalContactId: CONTACT })
  return em.seed(ChatExternalContact, { ...scope, id: CONTACT, network: 'whatsapp', displayName: 'Linh', customerEntityId: null })
}

async function link(em: FakeEm, sub: string, customerEntityId: string | null, options: { crm?: boolean; features?: string[] } = {}, contactId = CONTACT) {
  const handler = commandRegistry.get<Row, unknown>('chat.externalContacts.linkCustomer')
  if (!handler) throw new Error('chat.externalContacts.linkCustomer is not registered')
  return handler.execute(
    { ...scope, conversationId: CONVERSATION, externalContactId: contactId, customerEntityId },
    commandContext(em, sub, options),
  )
}

describe('chat.externalContacts.linkCustomer', () => {
  beforeEach(() => mockEmit.mockReset())

  it('links a record the colleague may open, and says so to the conversation', async () => {
    const em = new FakeEm()
    seedCrm(em)
    const contact = seedConversation(em, [[ALICE, 'participant']])
    await expect(link(em, ALICE, PERSON)).resolves.toEqual({ externalContactId: CONTACT, customerEntityId: PERSON })
    expect(contact).toMatchObject({ customerEntityId: PERSON, customerLinkedByUserId: ALICE })
    expect(contact.customerLinkedAt).toBeInstanceOf(Date)
    expect(mockEmit).toHaveBeenCalledWith(
      'chat.conversation.updated',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ change: 'contact_linked' }),
    )
  })

  it('unlinks', async () => {
    const em = new FakeEm()
    seedCrm(em)
    const contact = seedConversation(em, [[ALICE, 'manager']])
    await link(em, ALICE, PERSON)
    await link(em, ALICE, null)
    expect(contact).toMatchObject({ customerEntityId: null, customerLinkedByUserId: null, customerLinkedAt: null })
  })

  it('refuses a viewer', async () => {
    const em = new FakeEm()
    seedCrm(em)
    seedConversation(em, [[ALICE, 'manager'], [BOB, 'viewer']])
    await expect(link(em, BOB, PERSON)).rejects.toMatchObject({ status: 403 })
  })

  it('answers "not found" alike for a hidden kind, another organization and nothing at all', async () => {
    const em = new FakeEm()
    seedCrm(em)
    seedConversation(em, [[ALICE, 'participant']])
    for (const id of [COMPANY, FOREIGN_PERSON, randomUUID()]) {
      await expect(link(em, ALICE, id, { features: ['customers.people.view'] })).rejects.toMatchObject({
        status: 404,
        body: { error: 'crmRecordNotFound' },
      })
    }
  })

  it('links only an outsider of this conversation', async () => {
    const em = new FakeEm()
    seedCrm(em)
    seedConversation(em, [[ALICE, 'participant']])
    await expect(link(em, ALICE, PERSON, {}, randomUUID())).rejects.toMatchObject({
      status: 404,
      body: { error: 'contactNotInConversation' },
    })
  })

  it('is not there without a CRM', async () => {
    const em = new FakeEm()
    seedConversation(em, [[ALICE, 'participant']])
    await expect(link(em, ALICE, PERSON, { crm: false })).rejects.toMatchObject({ status: 400 })
  })

  it('never reaches into a conversation the colleague is not in', async () => {
    const em = new FakeEm()
    seedCrm(em)
    seedConversation(em, [[ALICE, 'participant']])
    await expect(link(em, BOB, PERSON)).rejects.toMatchObject({ status: 404 })
  })
})
