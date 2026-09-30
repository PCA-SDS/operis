import { randomUUID } from 'node:crypto'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { ChatMessagingAccount, ChatMessagingAccountMember } from '../data/entities'
import type { ChatAccountConnector } from '../lib/accountConnector'
import { normalizePhoneNumber } from '../commands/accounts'
import { toAccountDtos } from '../lib/accounts'
import '../commands/accounts'

/**
 * Messaging accounts: who may create, connect and remove one, and how the
 * connector's reports move it. Each command runs as a route runs it (a
 * logged-in user) or as the connector does (nobody logged in).
 */

const mockMembers = jest.fn()
const mockNotify = { create: jest.fn(), createForFeature: jest.fn() }

jest.mock('../lib/scope', () => ({
  ...jest.requireActual('../lib/scope'),
  loadOrganizationMembers: (...args: unknown[]) => mockMembers(...args),
  // The single-member lookup calls the real plural one internally, past the
  // mock above — so it is routed through the same fake here.
  loadOrganizationMember: async (em: unknown, scope: unknown, userId: string) =>
    ((await mockMembers(em, scope, [userId])) as Map<string, unknown>).get(userId) ?? null,
}))
jest.mock('../lib/clock', () => ({
  ...jest.requireActual('../lib/clock'),
  dbNow: async () => new Date('2026-09-29T12:00:00.000Z'),
}))
jest.mock('../lib/messages', () => ({
  ...jest.requireActual('../lib/messages'),
  loadChatMessages: async () => ({
    unauthorized: 'Unauthorized',
    validationFailed: 'Validation failed',
    memberNotFound: 'Member not found',
    accountNotFound: 'Account not found',
    accountNetworkUnavailable: 'Network unavailable',
    accountPersonalUnavailable: 'Personal unavailable',
    accountPersonalExists: 'Personal exists',
    accountTeamRequired: 'Team required',
    accountAlreadyConnected: 'Already connected',
    accountPhoneRequired: 'Phone required',
    accountUnreachable: 'Unreachable',
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: (em: FakeEm, entity: unknown, where: Row) => em.findOne(entity, where),
  findWithDecryption: (em: FakeEm, entity: unknown, where: Row) => em.find(entity, where),
}))
jest.mock('../../notifications/lib/notificationService', () => ({
  resolveNotificationService: () => mockNotify,
}))

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const ADMIN = '55555555-5555-4555-8555-555555555555'
const EMPLOYEE = '77777777-7777-4777-8777-777777777777'
const COLLEAGUE = '88888888-8888-4888-8888-888888888888'

type Row = Record<string, unknown>

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === '$or') return (value as Row[]).some((branch) => matches(row, branch))
    if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(row[key])
    if (value === null) return row[key] === null || row[key] === undefined
    return row[key] === value
  })
}

class FakeEm {
  readonly rows = new Map<unknown, Row[]>()
  private pending: Row[] = []
  failNextFlushWithUniqueViolation = false

  seed(entity: unknown, row: Row): Row {
    const bucket = this.rows.get(entity) ?? []
    bucket.push({ ...row, __entity: entity })
    this.rows.set(entity, bucket)
    return bucket[bucket.length - 1]!
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

  async findOneOrFail(entity: unknown, where: Row): Promise<Row> {
    const row = await this.findOne(entity, where)
    if (!row) throw new Error('not found')
    return row
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

  remove(row: Row): void {
    const bucket = this.rows.get(row.__entity) ?? []
    const index = bucket.indexOf(row)
    if (index >= 0) bucket.splice(index, 1)
  }

  async flush(): Promise<void> {
    if (this.failNextFlushWithUniqueViolation) {
      this.failNextFlushWithUniqueViolation = false
      this.pending = []
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    }
    for (const row of this.pending) {
      const bucket = this.rows.get(row.__entity) ?? []
      if (!bucket.includes(row)) bucket.push(row)
      this.rows.set(row.__entity, bucket)
    }
    this.pending = []
  }

  async transactional<T>(work: (tx: FakeEm) => Promise<T>): Promise<T> {
    return work(this)
  }
}

type FakeConnector = ChatAccountConnector & {
  startLogin: jest.Mock
  cancelLogin: jest.Mock
  logout: jest.Mock
  moveChat: jest.Mock
}

function fakeConnector(overrides: Partial<ChatAccountConnector> = {}): FakeConnector {
  return {
    id: 'fake',
    networks: () => ['whatsapp'],
    supportsPersonalAccounts: () => true,
    startLogin: jest.fn(async () => ({
      kind: 'step',
      step: { flow: 'qr', kind: 'qr', data: 'https://wa.me/settings/linked_devices#abc', attemptId: 'attempt-1' },
    })),
    cancelLogin: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    state: jest.fn(async () => ({ status: 'unknown' as const })),
    listChats: jest.fn(async () => []),
    moveChat: jest.fn(async () => ({ conversationId: '33333333-3333-4333-8333-333333333333' })),
    ...overrides,
  } as FakeConnector
}

function contextFor(
  em: FakeEm,
  options: { sub?: string; features?: Record<string, string[]>; connector?: ChatAccountConnector } = {},
): CommandRuntimeContext {
  const connector = options.connector ?? fakeConnector()
  const features = options.features ?? {}
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'chatAccountConnector') return connector
        if (name === 'rbacService') {
          return {
            userHasAllFeatures: async (userId: string, wanted: string[]) =>
              wanted.every((feature) => (features[userId] ?? []).includes(feature)),
          }
        }
        throw new Error(`unregistered ${name}`)
      },
      hasRegistration: (name: string) => name === 'chatAccountConnector',
    },
    auth: { tenantId: scope.tenantId, orgId: scope.organizationId, ...(options.sub ? { sub: options.sub } : {}) },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  } as unknown as CommandRuntimeContext
}

async function run<T>(commandId: string, ctx: CommandRuntimeContext, input: Row): Promise<T> {
  const handler = commandRegistry.get<Row, T>(commandId)
  if (!handler) throw new Error(`command ${commandId} is not registered`)
  return handler.execute({ ...scope, ...input }, ctx)
}

const MANAGE = { [ADMIN]: ['chat.accounts.manage'] }
const OWN = { [EMPLOYEE]: ['chat.accounts.connect_own'] }

function seedAccount(em: FakeEm, overrides: Row = {}): Row {
  return em.seed(ChatMessagingAccount, {
    id: randomUUID(),
    ...scope,
    network: 'whatsapp',
    ownerType: 'company',
    ownerUserId: null,
    displayName: 'Sales WhatsApp',
    status: 'pending',
    statusReason: null,
    showSenderName: false,
    loginStep: null,
    connectedAt: null,
    disconnectedAt: null,
    createdAt: new Date('2026-09-29T10:00:00.000Z'),
    updatedAt: new Date('2026-09-29T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  })
}

beforeEach(() => {
  mockMembers.mockReset()
  mockMembers.mockImplementation(async (_em: unknown, _scope: unknown, ids: string[]) =>
    new Map(ids.filter((id) => id !== OTHER_ORG).map((id) => [id, { id, name: `Person ${id.slice(0, 4)}`, email: '' }])),
  )
  mockNotify.create.mockReset()
  mockNotify.createForFeature.mockReset()
})

describe('chat.accounts.create', () => {
  it('creates a company account with its team, for a manager', async () => {
    const em = new FakeEm()
    const { accountId } = await run<{ accountId: string }>(
      'chat.accounts.create',
      contextFor(em, { sub: ADMIN, features: MANAGE }),
      { network: 'whatsapp', name: '  Sales WhatsApp  ', ownerType: 'company', memberUserIds: [COLLEAGUE, COLLEAGUE] },
    )
    const [account] = em.rowsOf(ChatMessagingAccount)
    expect(account).toMatchObject({ id: accountId, displayName: 'Sales WhatsApp', ownerType: 'company', status: 'pending' })
    expect(em.rowsOf(ChatMessagingAccountMember).map((row) => row.userId)).toEqual([COLLEAGUE])
  })

  it('refuses a company account without the manage feature', async () => {
    const em = new FakeEm()
    await expect(
      run('chat.accounts.create', contextFor(em, { sub: EMPLOYEE, features: OWN }), {
        network: 'whatsapp',
        name: 'Sales',
        ownerType: 'company',
        memberUserIds: [COLLEAGUE],
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.rowsOf(ChatMessagingAccount)).toHaveLength(0)
  })

  it('refuses a company account with no team, and a team member from elsewhere', async () => {
    const em = new FakeEm()
    const ctx = contextFor(em, { sub: ADMIN, features: MANAGE })
    await expect(
      run('chat.accounts.create', ctx, { network: 'whatsapp', name: 'Sales', ownerType: 'company', memberUserIds: [] }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'Team required' } })
    await expect(
      run('chat.accounts.create', ctx, {
        network: 'whatsapp',
        name: 'Sales',
        ownerType: 'company',
        memberUserIds: [OTHER_ORG],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a network the deployment cannot connect', async () => {
    const em = new FakeEm()
    await expect(
      run('chat.accounts.create', contextFor(em, { sub: ADMIN, features: MANAGE }), {
        network: 'telegram',
        name: 'Sales',
        ownerType: 'company',
        memberUserIds: [COLLEAGUE],
      }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'Network unavailable' } })
  })

  it('creates a personal account owned by the caller, one per network', async () => {
    const em = new FakeEm()
    const ctx = contextFor(em, { sub: EMPLOYEE, features: OWN })
    await run('chat.accounts.create', ctx, { network: 'whatsapp', name: 'Mine', ownerType: 'user', memberUserIds: [] })
    expect(em.rowsOf(ChatMessagingAccount)[0]).toMatchObject({ ownerType: 'user', ownerUserId: EMPLOYEE })

    em.failNextFlushWithUniqueViolation = true
    await expect(
      run('chat.accounts.create', ctx, { network: 'whatsapp', name: 'Again', ownerType: 'user', memberUserIds: [] }),
    ).rejects.toMatchObject({ status: 409, body: { error: 'Personal exists' } })
  })

  it('refuses a personal account where the connector cannot hold one', async () => {
    const em = new FakeEm()
    await expect(
      run(
        'chat.accounts.create',
        contextFor(em, { sub: EMPLOYEE, features: OWN, connector: fakeConnector({ supportsPersonalAccounts: () => false }) }),
        { network: 'whatsapp', name: 'Mine', ownerType: 'user', memberUserIds: [] },
      ),
    ).rejects.toMatchObject({ status: 400, body: { error: 'Personal unavailable' } })
  })
})

describe('chat.accounts.connect', () => {
  it('shows the first code and remembers which attempt it belongs to', async () => {
    const em = new FakeEm()
    const account = seedAccount(em)
    const connector = fakeConnector()
    await run('chat.accounts.connect', contextFor(em, { sub: ADMIN, features: MANAGE, connector }), {
      accountId: account.id,
      flow: 'qr',
    })
    expect(connector.startLogin).toHaveBeenCalledTimes(1)
    expect(connector.startLogin.mock.calls[0]?.[1]).toMatchObject({ id: account.id, ownerType: 'company', ownerUserId: null })
    expect(account).toMatchObject({ status: 'connecting', connectedByUserId: ADMIN, statusReason: null })
    expect(account.loginStep).toMatchObject({ kind: 'qr', attemptId: 'attempt-1' })
  })

  it('normalises the phone number before the connector sees it, and refuses one that is not', async () => {
    const em = new FakeEm()
    const account = seedAccount(em)
    const connector = fakeConnector()
    const ctx = contextFor(em, { sub: ADMIN, features: MANAGE, connector })
    await expect(
      run('chat.accounts.connect', ctx, { accountId: account.id, flow: 'phone', phoneNumber: '0151 234' }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'Phone required' } })
    await run('chat.accounts.connect', ctx, { accountId: account.id, flow: 'phone', phoneNumber: '+49 (151) 234-567 89' })
    expect(connector.startLogin.mock.calls[0]?.[3]).toEqual({ phoneNumber: '+4915123456789' })
  })

  it('records a login the connector already finished, or one it refused', async () => {
    const em = new FakeEm()
    const done = seedAccount(em)
    await run(
      'chat.accounts.connect',
      contextFor(em, {
        sub: ADMIN,
        features: MANAGE,
        connector: fakeConnector({
          startLogin: jest.fn(async () => ({ kind: 'connected' as const, remoteHandle: '+4915123456789', remoteName: 'Acme' })),
        }),
      }),
      { accountId: done.id, flow: 'qr' },
    )
    expect(done).toMatchObject({ status: 'connected', remoteHandle: '+4915123456789', loginStep: null })

    const refused = seedAccount(em)
    await run(
      'chat.accounts.connect',
      contextFor(em, {
        sub: ADMIN,
        features: MANAGE,
        connector: fakeConnector({ startLogin: jest.fn(async () => ({ kind: 'failed' as const, reason: 'rate_limited' as const })) }),
      }),
      { accountId: refused.id, flow: 'qr' },
    )
    expect(refused).toMatchObject({ status: 'failed', statusReason: 'rate_limited' })
  })

  it('refuses an account that is already connected', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { status: 'connected', connectedAt: new Date() })
    await expect(
      run('chat.accounts.connect', contextFor(em, { sub: ADMIN, features: MANAGE }), { accountId: account.id, flow: 'qr' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('answers 404, not 403, for an account the caller may not manage', async () => {
    const em = new FakeEm()
    const company = seedAccount(em)
    const someoneElses = seedAccount(em, { ownerType: 'user', ownerUserId: COLLEAGUE })
    const otherOrg = seedAccount(em, { organizationId: OTHER_ORG })
    await expect(
      run('chat.accounts.connect', contextFor(em, { sub: EMPLOYEE, features: OWN }), { accountId: company.id, flow: 'qr' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      run('chat.accounts.connect', contextFor(em, { sub: EMPLOYEE, features: OWN }), {
        accountId: someoneElses.id,
        flow: 'qr',
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      run('chat.accounts.connect', contextFor(em, { sub: ADMIN, features: MANAGE }), { accountId: otherOrg.id, flow: 'qr' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('turns an unreachable connector into a 503 a person can retry', async () => {
    const em = new FakeEm()
    const account = seedAccount(em)
    await expect(
      run(
        'chat.accounts.connect',
        contextFor(em, {
          sub: ADMIN,
          features: MANAGE,
          connector: fakeConnector({
            startLogin: jest.fn(async () => {
              throw new Error('connect ECONNREFUSED 10.0.0.7:29318')
            }),
          }),
        }),
        { accountId: account.id, flow: 'qr' },
      ),
    ).rejects.toMatchObject({ status: 503, body: { error: 'Unreachable' } })
    expect(account.status).toBe('pending')
  })
})

describe('the connector reporting', () => {
  it('refuses a context with a logged-in user', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { status: 'connecting', loginStep: { attemptId: 'attempt-1' } })
    await expect(
      run('chat.accounts.markState', contextFor(em, { sub: ADMIN, features: MANAGE }), {
        accountId: account.id,
        attemptId: 'attempt-1',
        status: 'connected',
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(account.status).toBe('connecting')
  })

  it('shows a rotated code only for the attempt on screen', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, {
      status: 'connecting',
      loginStep: { flow: 'qr', kind: 'qr', data: 'first', attemptId: 'attempt-2', updatedAt: 'x' },
    })
    const stale = await run<{ applied: boolean }>('chat.accounts.recordLoginStep', contextFor(em), {
      accountId: account.id,
      step: { flow: 'qr', kind: 'qr', data: 'stale', attemptId: 'attempt-1' },
    })
    expect(stale.applied).toBe(false)
    const current = await run<{ applied: boolean }>('chat.accounts.recordLoginStep', contextFor(em), {
      accountId: account.id,
      step: { flow: 'qr', kind: 'qr', data: 'second', attemptId: 'attempt-2' },
    })
    expect(current.applied).toBe(true)
    expect(account.loginStep).toMatchObject({ data: 'second', attemptId: 'attempt-2' })
  })

  it('finishes the current login and ignores one that was replaced', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { status: 'connecting', loginStep: { attemptId: 'attempt-2' } })
    const late = await run<{ applied: boolean }>('chat.accounts.markState', contextFor(em), {
      accountId: account.id,
      attemptId: 'attempt-1',
      status: 'connected',
    })
    expect(late.applied).toBe(false)
    await run('chat.accounts.markState', contextFor(em), {
      accountId: account.id,
      attemptId: 'attempt-2',
      status: 'connected',
      remoteHandle: '+4915123456789',
    })
    expect(account).toMatchObject({ status: 'connected', remoteHandle: '+4915123456789', loginStep: null })
    expect(account.connectedAt).toBeInstanceOf(Date)
  })

  it('tells every manager once when a company account drops', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { status: 'connected', connectedAt: new Date() })
    await run('chat.accounts.markState', contextFor(em), { accountId: account.id, status: 'disconnected', reason: 'logged_out' })
    await run('chat.accounts.markState', contextFor(em), { accountId: account.id, status: 'disconnected', reason: 'logged_out' })
    expect(account).toMatchObject({ status: 'disconnected', statusReason: 'logged_out' })
    expect(mockNotify.createForFeature).toHaveBeenCalledTimes(1)
    expect(mockNotify.createForFeature.mock.calls[0]?.[0]).toMatchObject({
      type: 'chat.account.disconnected',
      requiredFeature: 'chat.accounts.manage',
      restrictRecipientsToOrganization: true,
    })
    expect(mockNotify.createForFeature.mock.calls[0]?.[1]).toEqual(scope)
  })

  it('tells only the owner when a personal account drops', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { ownerType: 'user', ownerUserId: EMPLOYEE, status: 'connected', connectedAt: new Date() })
    await run('chat.accounts.markState', contextFor(em), { accountId: account.id, status: 'disconnected', reason: 'bad_credentials' })
    expect(mockNotify.createForFeature).not.toHaveBeenCalled()
    expect(mockNotify.create.mock.calls[0]?.[0]).toMatchObject({ recipientUserId: EMPLOYEE })
  })

  it('lets a health report restore a dropped account but never finish a login on screen', async () => {
    const em = new FakeEm()
    const dropped = seedAccount(em, { status: 'disconnected', connectedAt: new Date() })
    await run('chat.accounts.markState', contextFor(em), { accountId: dropped.id, status: 'connected' })
    expect(dropped.status).toBe('connected')

    const onScreen = seedAccount(em, { status: 'connecting', loginStep: { attemptId: 'attempt-1' } })
    const result = await run<{ applied: boolean }>('chat.accounts.markState', contextFor(em), {
      accountId: onScreen.id,
      status: 'connected',
    })
    expect(result.applied).toBe(false)
    expect(onScreen.status).toBe('connecting')
  })
})

describe('cancel, disconnect, delete', () => {
  it('cancels a login back to where the account was', async () => {
    const em = new FakeEm()
    const fresh = seedAccount(em, { status: 'connecting', loginStep: { attemptId: 'a' } })
    const again = seedAccount(em, { status: 'connecting', connectedAt: new Date(), loginStep: { attemptId: 'b' } })
    const connector = fakeConnector()
    const ctx = contextFor(em, { sub: ADMIN, features: MANAGE, connector })
    await run('chat.accounts.cancelConnect', ctx, { accountId: fresh.id })
    await run('chat.accounts.cancelConnect', ctx, { accountId: again.id })
    expect(fresh).toMatchObject({ status: 'pending', loginStep: null })
    expect(again).toMatchObject({ status: 'disconnected', loginStep: null })
    expect(connector.cancelLogin).toHaveBeenCalledTimes(2)
  })

  /**
   * The race a real bridge exposed: cancelling ends the connector's wait at
   * once, and its "failed: cancelled" report used to land after the cancel.
   */
  it('lets go of the attempt before the network hears "cancel", so a late report is dropped', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { status: 'connecting', loginStep: { attemptId: 'a' } })
    let seenByTheNetwork: unknown = null
    const connector = fakeConnector({
      cancelLogin: jest.fn(async () => {
        seenByTheNetwork = { status: account.status, loginStep: account.loginStep }
      }),
    })
    await run('chat.accounts.cancelConnect', contextFor(em, { sub: ADMIN, features: MANAGE, connector }), {
      accountId: account.id,
    })
    expect(seenByTheNetwork).toEqual({ status: 'pending', loginStep: null })

    const late = await run<{ applied: boolean }>('chat.accounts.markState', contextFor(em), {
      accountId: account.id,
      attemptId: 'a',
      status: 'failed',
      reason: 'cancelled',
    })
    expect(late).toEqual({ applied: false })
    expect(account).toMatchObject({ status: 'pending', statusReason: null })
  })

  it('logs out before it removes, and removes nothing when the network cannot be reached', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { status: 'connected', connectedAt: new Date() })
    const failing = fakeConnector({
      logout: jest.fn(async () => {
        throw new Error('bridge down')
      }),
    })
    await expect(
      run('chat.accounts.delete', contextFor(em, { sub: ADMIN, features: MANAGE, connector: failing }), {
        accountId: account.id,
      }),
    ).rejects.toMatchObject({ status: 503 })
    expect(account.deletedAt).toBeNull()

    const connector = fakeConnector()
    await run('chat.accounts.delete', contextFor(em, { sub: ADMIN, features: MANAGE, connector }), { accountId: account.id })
    expect(connector.logout).toHaveBeenCalledTimes(1)
    expect(account.deletedAt).toBeInstanceOf(Date)
    expect(account.status).toBe('disconnected')
  })

  it('refuses a stale edit with the optimistic-lock conflict', async () => {
    const em = new FakeEm()
    const account = seedAccount(em)
    const ctx = contextFor(em, { sub: ADMIN, features: MANAGE })
    ;(ctx as { request?: Request }).request = new Request('http://localhost', {
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-28T00:00:00.000Z' },
    })
    await expect(
      run('chat.accounts.update', ctx, { accountId: account.id, name: 'Renamed' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(account.displayName).toBe('Sales WhatsApp')
  })
})

describe('what the page is shown', () => {
  it('never hands the attempt id to a browser', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, {
      status: 'connecting',
      loginStep: { flow: 'qr', kind: 'qr', data: 'code', attemptId: 'secret-attempt', updatedAt: '2026-09-29T12:00:00.000Z' },
    })
    const [dto] = await toAccountDtos(em as never, scope, [account as never])
    expect(dto?.loginStep).toEqual({ flow: 'qr', kind: 'qr', data: 'code', updatedAt: '2026-09-29T12:00:00.000Z' })
    expect(JSON.stringify(dto)).not.toContain('secret-attempt')
  })
})

describe('normalizePhoneNumber', () => {
  it.each([
    ['+49 151 23456789', '+4915123456789'],
    ['0049 151 23456789', '+4915123456789'],
    ['+1 (415) 555-0100', '+14155550100'],
    ['0151 23456789', null],
    ['+0 123 456 789', null],
    ['', null],
    [null, null],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhoneNumber(raw)).toBe(expected)
  })
})

/**
 * Moving a chat off a personal WhatsApp is its owner's decision alone, and only
 * while the number is connected; everything else reads as "no such account".
 */
describe('chat.accounts.moveChat', () => {
  const personal = (em: FakeEm, overrides: Row = {}) =>
    seedAccount(em, { ownerType: 'user', ownerUserId: EMPLOYEE, displayName: 'Ana', status: 'connected', ...overrides })

  it('hands the chat to the connector for the owner', async () => {
    const em = new FakeEm()
    const account = personal(em)
    const connector = fakeConnector()
    await expect(
      run('chat.accounts.moveChat', contextFor(em, { sub: EMPLOYEE, features: OWN, connector }), {
        accountId: account.id,
        chatId: '!portal:operis.local',
      }),
    ).resolves.toEqual({ conversationId: '33333333-3333-4333-8333-333333333333' })
    expect(connector.moveChat.mock.calls[0]?.[1]).toMatchObject({ id: account.id, ownerType: 'user', ownerUserId: EMPLOYEE })
    expect(connector.moveChat.mock.calls[0]?.[2]).toBe('!portal:operis.local')
  })

  it('is nobody else’s to do — not even an account manager’s', async () => {
    const em = new FakeEm()
    const account = personal(em)
    const connector = fakeConnector()
    await expect(
      run('chat.accounts.moveChat', contextFor(em, { sub: ADMIN, features: MANAGE, connector }), {
        accountId: account.id,
        chatId: '!portal:operis.local',
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(connector.moveChat).not.toHaveBeenCalled()
  })

  it('never moves a company number’s chats, which arrive by themselves', async () => {
    const em = new FakeEm()
    const account = seedAccount(em, { status: 'connected' })
    await expect(
      run('chat.accounts.moveChat', contextFor(em, { sub: ADMIN, features: MANAGE }), {
        accountId: account.id,
        chatId: '!portal:operis.local',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('waits for the number to be connected', async () => {
    const em = new FakeEm()
    const account = personal(em, { status: 'disconnected' })
    await expect(
      run('chat.accounts.moveChat', contextFor(em, { sub: EMPLOYEE, features: OWN }), {
        accountId: account.id,
        chatId: '!portal:operis.local',
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('says so when the chat is not on the number', async () => {
    const em = new FakeEm()
    const account = personal(em)
    await expect(
      run(
        'chat.accounts.moveChat',
        contextFor(em, { sub: EMPLOYEE, features: OWN, connector: fakeConnector({ moveChat: jest.fn(async () => null) }) }),
        { accountId: account.id, chatId: '!gone:operis.local' },
      ),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('a personal account’s name', () => {
  it('is its owner’s, unless they give it one', async () => {
    const em = new FakeEm()
    await run('chat.accounts.create', contextFor(em, { sub: EMPLOYEE, features: OWN }), {
      network: 'whatsapp',
      ownerType: 'user',
      memberUserIds: [],
    })
    expect(em.rowsOf(ChatMessagingAccount)[0]).toMatchObject({ displayName: `Person ${EMPLOYEE.slice(0, 4)}` })
  })

  it('is still required for a company account', async () => {
    const em = new FakeEm()
    await expect(
      run('chat.accounts.create', contextFor(em, { sub: ADMIN, features: MANAGE }), {
        network: 'whatsapp',
        ownerType: 'company',
        memberUserIds: [EMPLOYEE],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
