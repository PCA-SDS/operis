import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { ChatConversation, ChatParticipant } from '../data/entities'
import { chatAddMembersSchema, chatSendMessageSchema, chatSetMemberRoleSchema } from '../data/validators'
import { accessOf, hasAccess, isChatAccess } from '../lib/access'
import '../commands/spaces'

/**
 * Access levels in a client conversation: who may reply, who may decide who is
 * in it, and the rule that it always keeps a colleague and a manager.
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

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const ALICE = '55555555-5555-4555-8555-555555555555'
const BOB = '77777777-7777-4777-8777-777777777777'
const CAROL = '88888888-8888-4888-8888-888888888888'

type Row = Record<string, unknown>

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(row[key])
    if (value && typeof value === 'object' && '$ne' in value) {
      const other = (value as { $ne: unknown }).$ne
      return other === null ? row[key] !== null && row[key] !== undefined : row[key] !== other
    }
    if (value === null) return row[key] === null || row[key] === undefined
    return row[key] === value
  })
}

class FakeEm {
  readonly rows = new Map<unknown, Row[]>()
  readonly locks: unknown[] = []
  private pending: Row[] = []
  private removed: Row[] = []

  seed(entity: unknown, row: Row): Row {
    const bucket = this.rows.get(entity) ?? []
    bucket.push(row)
    this.rows.set(entity, bucket)
    return row
  }

  rowsOf(entity: unknown): Row[] {
    return [...(this.rows.get(entity) ?? [])]
  }

  fork(): FakeEm {
    return this
  }

  async findOne(entity: unknown, where: Row, options?: { lockMode?: unknown }): Promise<Row | null> {
    if (options?.lockMode !== undefined) this.locks.push(entity)
    return this.rowsOf(entity).find((row) => matches(row, where)) ?? null
  }

  async find(entity: unknown, where: Row): Promise<Row[]> {
    return this.rowsOf(entity).filter((row) => matches(row, where))
  }

  async count(entity: unknown, where: Row): Promise<number> {
    return (await this.find(entity, where)).length
  }

  create(entity: unknown, data: Row): Row {
    return { id: randomUUID(), ...data, __entity: entity }
  }

  persist(row: Row): void {
    this.pending.push(row)
  }

  remove(row: Row): void {
    this.removed.push(row)
  }

  async flush(): Promise<void> {
    for (const row of this.pending) {
      if (!this.rowsOf(row.__entity).includes(row)) this.seed(row.__entity, row)
    }
    for (const row of this.removed) {
      for (const [entity, bucket] of this.rows) this.rows.set(entity, bucket.filter((candidate) => candidate !== row))
    }
    this.pending = []
    this.removed = []
  }

  async transactional<T>(work: (tx: FakeEm) => Promise<T>): Promise<T> {
    return work(this)
  }
}

function contextFor(em: FakeEm, sub: string): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`unregistered ${name}`)
      },
    },
    auth: { tenantId: scope.tenantId, orgId: scope.organizationId, sub },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  } as unknown as CommandRuntimeContext
}

async function run<T>(commandId: string, em: FakeEm, sub: string, input: Row): Promise<T> {
  const handler = commandRegistry.get<Row, T>(commandId)
  if (!handler) throw new Error(`command ${commandId} is not registered`)
  return handler.execute({ ...scope, conversationId: CONVERSATION, ...input }, contextFor(em, sub))
}

function seedChat(kind: 'external' | 'space', seats: Array<[string, string | null, string?]>): FakeEm {
  const em = new FakeEm()
  em.seed(ChatConversation, { ...scope, id: CONVERSATION, kind, deletedAt: null })
  for (const [userId, access, role] of seats) {
    em.seed(ChatParticipant, {
      ...scope,
      id: randomUUID(),
      conversationId: CONVERSATION,
      userId,
      role: role ?? 'member',
      access,
    })
  }
  return em
}

function accessIn(em: FakeEm, userId: string): unknown {
  return em.rowsOf(ChatParticipant).find((row) => row.userId === userId)?.access
}

beforeEach(() => {
  mockEmit.mockReset()
})

describe('the levels', () => {
  it('ranks viewer below participant below manager', () => {
    expect(hasAccess({ access: 'viewer' }, 'participant')).toBe(false)
    expect(hasAccess({ access: 'participant' }, 'participant')).toBe(true)
    expect(hasAccess({ access: 'participant' }, 'manager')).toBe(false)
    expect(hasAccess({ access: 'manager' }, 'viewer')).toBe(true)
  })

  it('reads a row from before levels existed as manager, never less', () => {
    expect(accessOf({ access: null })).toBe('manager')
    expect(accessOf(null)).toBe('manager')
    expect(hasAccess({ access: null }, 'manager')).toBe(true)
  })

  it('knows only the three levels', () => {
    expect(['viewer', 'participant', 'manager'].every(isChatAccess)).toBe(true)
    expect(isChatAccess('owner')).toBe(false)
    expect(isChatAccess(undefined)).toBe(false)
  })
})

describe('the request shapes', () => {
  it('sets a role or a level, never both, and nothing else', () => {
    expect(chatSetMemberRoleSchema.parse({ access: 'viewer' })).toEqual({ access: 'viewer' })
    expect(chatSetMemberRoleSchema.parse({ role: 'owner' })).toEqual({ role: 'owner' })
    expect(() => chatSetMemberRoleSchema.parse({ role: 'owner', access: 'viewer' })).toThrow()
    expect(() => chatSetMemberRoleSchema.parse({ access: 'admin' })).toThrow()
  })

  it('lets the adder choose the level', () => {
    expect(chatAddMembersSchema.parse({ memberIds: [BOB], access: 'participant' })).toEqual({
      memberIds: [BOB],
      access: 'participant',
    })
    expect(chatAddMembersSchema.parse({ memberIds: [BOB] }).access).toBeUndefined()
    expect(() => chatAddMembersSchema.parse({ memberIds: [BOB], access: 'owner' })).toThrow()
  })

  it('accepts only the two visibilities', () => {
    expect(chatSendMessageSchema.parse({ body: 'for colleagues', visibility: 'internal' }).visibility).toBe('internal')
    expect(chatSendMessageSchema.parse({ body: 'to the client' }).visibility).toBeUndefined()
    expect(() => chatSendMessageSchema.parse({ body: 'x', visibility: 'secret' })).toThrow()
  })
})

describe('chat.conversations.setAccess', () => {
  it('lets a manager change a colleague, under the conversation lock', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'viewer']])
    await expect(run('chat.conversations.setAccess', em, ALICE, { userId: BOB, access: 'participant' })).resolves.toEqual({
      userId: BOB,
      access: 'participant',
    })
    expect(accessIn(em, BOB)).toBe('participant')
    expect(em.locks).toContain(ChatConversation)
    expect(mockEmit).toHaveBeenCalledWith(
      'chat.conversation.updated',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ change: 'access_changed' }),
    )
  })

  it('refuses anyone who is not a manager', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'participant'], [CAROL, 'viewer']])
    await expect(
      run('chat.conversations.setAccess', em, BOB, { userId: CAROL, access: 'participant' }),
    ).rejects.toMatchObject({ status: 403 })
    expect(accessIn(em, CAROL)).toBe('viewer')
  })

  it('keeps the last manager', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'participant']])
    await expect(
      run('chat.conversations.setAccess', em, ALICE, { userId: ALICE, access: 'participant' }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'lastManagerCannotLeave' } })
    expect(accessIn(em, ALICE)).toBe('manager')
  })

  it('lets a manager step down once somebody else manages', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'participant']])
    await run('chat.conversations.setAccess', em, ALICE, { userId: BOB, access: 'manager' })
    await run('chat.conversations.setAccess', em, ALICE, { userId: ALICE, access: 'viewer' })
    expect(accessIn(em, ALICE)).toBe('viewer')
    expect(accessIn(em, BOB)).toBe('manager')
  })

  it('counts a colleague from before levels existed as a manager', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, null]])
    await run('chat.conversations.setAccess', em, ALICE, { userId: ALICE, access: 'participant' })
    expect(accessIn(em, ALICE)).toBe('participant')
  })

  it('writes and announces nothing when the level is already set', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'viewer']])
    await run('chat.conversations.setAccess', em, ALICE, { userId: BOB, access: 'viewer' })
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('has no levels to set in a space', async () => {
    const em = seedChat('space', [[ALICE, null, 'owner'], [BOB, null]])
    await expect(
      run('chat.conversations.setAccess', em, ALICE, { userId: BOB, access: 'manager' }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('leaving and removing in a client conversation', () => {
  it('keeps the last colleague with the customer', async () => {
    const em = seedChat('external', [[ALICE, 'manager']])
    await expect(run('chat.spaces.removeMember', em, ALICE, { userId: ALICE })).rejects.toMatchObject({
      status: 400,
      body: { error: 'lastColleagueCannotLeave' },
    })
    expect(em.rowsOf(ChatParticipant)).toHaveLength(1)
  })

  it('keeps the last manager while anyone is left to manage', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'viewer']])
    await expect(run('chat.spaces.removeMember', em, ALICE, { userId: ALICE })).rejects.toMatchObject({
      status: 400,
      body: { error: 'lastManagerCannotLeave' },
    })
    expect(em.locks).toContain(ChatConversation)
  })

  it('lets anyone else leave', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'viewer']])
    await expect(run('chat.spaces.removeMember', em, BOB, { userId: BOB })).resolves.toEqual({
      removed: BOB,
      spaceDeleted: false,
    })
    expect(em.rowsOf(ChatParticipant).map((row) => row.userId)).toEqual([ALICE])
  })

  it('lets only a manager remove somebody else', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'participant'], [CAROL, 'viewer']])
    await expect(run('chat.spaces.removeMember', em, BOB, { userId: CAROL })).rejects.toMatchObject({ status: 403 })
    await expect(run('chat.spaces.removeMember', em, ALICE, { userId: CAROL })).resolves.toMatchObject({ removed: CAROL })
  })

  it('lets a manager hand the chat over and leave', async () => {
    const em = seedChat('external', [[ALICE, 'manager'], [BOB, 'manager']])
    await run('chat.spaces.removeMember', em, ALICE, { userId: ALICE })
    expect(em.rowsOf(ChatParticipant).map((row) => row.userId)).toEqual([BOB])
  })
})

describe('the migrations', () => {
  const MIGRATIONS = path.resolve(__dirname, '../migrations')
  const read = (name: string) => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8').split('override down()')

  it('lets only a colleague’s own message be internal, and will not go down while one exists', () => {
    const [UP, DOWN] = read('Migration20260929161918_chat.ts')
    expect(UP).toContain(`add "visibility" text not null default 'shared'`)
    expect(UP).toContain(
      `check ("visibility" in ('shared', 'internal') and ("visibility" = 'shared' or ("kind" = 'user' and "sender_user_id" is not null)))`,
    )
    expect(DOWN).toContain('raise exception')
  })

  it('gives levels to colleagues only, and keeps what everyone could already do', () => {
    const [UP] = read('Migration20260929162447_chat.ts')
    expect(UP).toContain(
      `check ("access" is null or ("access" in ('viewer', 'participant', 'manager') and "user_id" is not null))`,
    )
    expect(UP).toContain(`set "access" = 'manager'`)
    expect(UP).toContain(`c."kind" = 'external'`)
  })
})
