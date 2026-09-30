import { MatrixClient as MatrixClientExport, type MatrixConfig, type MatrixEvent } from '@open-mercato/matrix'
import type { ConnectorAccount } from '@open-mercato/core/modules/chat/lib/accountConnector'
import { ChatMatrixAccountLogin, ChatMatrixRoom } from '../data/entities'
import { listPersonalChats, movePersonalChat } from '../lib/personalChats'
import { projectEvent } from '../lib/projection'
import { resetBotRegistrations } from '../lib/identities'
import { FakeEntityManager, FakeMatrixClient } from './fakes'

/**
 * A personal WhatsApp is private until its owner moves a chat: listing reads
 * names live as the owner, moving maps one room and only then lets the Operis
 * bot in, and nothing said before the move is ever projected.
 */

jest.mock('@open-mercato/matrix', () => {
  const actual = jest.requireActual('@open-mercato/matrix')
  return { ...actual, MatrixClient: jest.fn() }
})
const MatrixClient = MatrixClientExport as unknown as jest.Mock

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const ACCOUNT = '0a0b0c0d-1111-4222-8333-444455556666'
const OWNER = '64097a24-ecb4-4795-80c2-bb466858f186'
const PERSONAL_MXID = '@opp_0a0b0c0d111142228333444455556666:operis.local'
const GHOST = '@whatsapp_4915123456789:operis.local'
const GHOST_TWO = '@whatsapp_lid-654321:operis.local'
const BRIDGE_BOT = '@whatsappbot:operis.local'
const BOT = '@om_bot:operis.local'
const DIRECT = '!direct:operis.local'
const GROUP = '!group:operis.local'
const MANAGEMENT = '!management:operis.local'
const ELSEWHERE = '!elsewhere:operis.local'
const CONVERSATION = '33333333-3333-4333-8333-333333333333'

const config: MatrixConfig = {
  baseUrl: 'http://synapse:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
  senderLocalpart: 'operis',
  userPrefix: 'om_',
  botLocalpart: 'om_bot',
  bridgeGhosts: [{ network: 'whatsapp', prefix: 'whatsapp_' }],
  doublePuppetAsToken: 'd'.repeat(64),
}

/**
 * The owner's client. `lib/accounts.ts` builds the accounts-scoped client once
 * per process, so every test talks to this one instance, reset in `setup`.
 */
const personal = new FakeMatrixClient()
MatrixClient.mockImplementation(() => personal.asClient())

/** One store for the whole test: the mover writes through forks it expects to land. */
class SharedEntityManager extends FakeEntityManager {
  override fork(): FakeEntityManager {
    return this
  }
}

const account: ConnectorAccount = {
  id: ACCOUNT,
  network: 'whatsapp',
  ownerType: 'user',
  ownerUserId: OWNER,
  scope,
}

function setup(options: { loggedIn?: boolean } = {}) {
  const em = new SharedEntityManager()
  em.seed(ChatMatrixAccountLogin, {
    ...scope,
    accountId: ACCOUNT,
    ownerType: 'user',
    network: 'whatsapp',
    mxid: PERSONAL_MXID,
    registeredAt: new Date('2026-09-30T08:00:00.000Z'),
    userLoginId: options.loggedIn === false ? null : 'wa-login',
  })
  personal.calls.length = 0
  personal.failOn = null
  personal.joinedByRoom = {
    [DIRECT]: { [PERSONAL_MXID]: {}, [GHOST]: { display_name: 'Linh Tran' } },
    [GROUP]: { [PERSONAL_MXID]: {}, [GHOST]: { display_name: 'Linh Tran' }, [GHOST_TWO]: { display_name: 'Bao' } },
    [MANAGEMENT]: { [PERSONAL_MXID]: {}, [BRIDGE_BOT]: {} },
    [ELSEWHERE]: { '@someone:operis.local': {}, [GHOST]: {} },
  }
  personal.roomNames = { [GROUP]: 'Supplier group' }
  const appservice = new FakeMatrixClient()
  const executed: Array<{ commandId: string; input: Record<string, unknown> }> = []
  const commandBus = {
    execute: async (commandId: string, options: { input: Record<string, unknown> }) => {
      executed.push({ commandId, input: options.input })
      if (commandId === 'chat.conversations.createExternal') return { result: { conversationId: CONVERSATION } }
      return { result: {} }
    },
  }
  const ctx = {
    em: em.asEntityManager(),
    container: { resolve: (name: string) => (name === 'commandBus' ? commandBus : undefined) },
  }
  return { em, appservice, executed, ctx, deps: { config, client: appservice.asClient() } }
}

beforeEach(() => {
  resetBotRegistrations()
})

describe('listing a personal account’s chats', () => {
  it('names each chat the owner is in, and nothing else', async () => {
    const { deps, ctx } = setup()
    await expect(listPersonalChats(deps, ctx, account)).resolves.toEqual([
      { id: DIRECT, name: 'Linh Tran', kind: 'direct', conversationId: null },
      { id: GROUP, name: 'Supplier group', kind: 'group', conversationId: null },
    ])
  })

  it('reads as the owner’s own identity', async () => {
    const { deps, ctx } = setup()
    await listPersonalChats(deps, ctx, account)
    expect(personal.callsTo('joinedRooms')).toEqual([{ method: 'joinedRooms', args: [PERSONAL_MXID] }])
    expect(personal.callsTo('joinedMembers').every((call) => call.args[1] === PERSONAL_MXID)).toBe(true)
  })

  it('marks a chat already moved, and hides one mapped to anything else', async () => {
    const { deps, ctx, em } = setup()
    em.seed(ChatMatrixRoom, { ...scope, roomId: DIRECT, conversationId: CONVERSATION, accountId: ACCOUNT })
    em.seed(ChatMatrixRoom, { ...scope, roomId: GROUP, conversationId: 'other', accountId: null })
    await expect(listPersonalChats(deps, ctx, account)).resolves.toEqual([
      { id: DIRECT, name: 'Linh Tran', kind: 'direct', conversationId: CONVERSATION },
    ])
  })

  it('has nothing to show for a company account or one not logged in', async () => {
    const company = setup()
    await expect(
      listPersonalChats(company.deps, company.ctx, { ...account, ownerType: 'company', ownerUserId: null }),
    ).resolves.toEqual([])
    const loggedOut = setup({ loggedIn: false })
    await expect(listPersonalChats(loggedOut.deps, loggedOut.ctx, account)).resolves.toEqual([])
  })
})

describe('moving a chat to the company', () => {
  it('opens a conversation for the owner, maps the room from now on, and only then lets the bot in', async () => {
    const { deps, ctx, em, appservice, executed } = setup()
    const before = Date.now()
    await expect(movePersonalChat(deps, ctx, account, DIRECT)).resolves.toEqual({ conversationId: CONVERSATION })

    expect(executed.map((call) => call.commandId)).toEqual([
      'chat.externalContacts.ensure',
      'chat.conversations.createExternal',
    ])
    expect(executed[0]!.input).toMatchObject({ network: 'whatsapp', displayName: 'Linh Tran', handle: '+4915123456789' })
    expect(executed[1]!.input).toMatchObject({ memberUserIds: [OWNER], messagingAccountId: ACCOUNT, title: null })

    const [room] = em.rowsOf(ChatMatrixRoom)
    expect(room).toMatchObject({ roomId: DIRECT, conversationId: CONVERSATION, accountId: ACCOUNT, state: 'ready' })
    expect((room!.projectFrom as Date).getTime()).toBeGreaterThanOrEqual(before)

    expect(personal.callsTo('invite')).toEqual([{ method: 'invite', args: [DIRECT, BOT, PERSONAL_MXID] }])
    expect(appservice.callsTo('join')).toEqual([{ method: 'join', args: [DIRECT, BOT] }])
  })

  it('returns the same conversation for a chat moved before', async () => {
    const { deps, ctx, em, executed } = setup()
    em.seed(ChatMatrixRoom, { ...scope, roomId: DIRECT, conversationId: CONVERSATION, accountId: ACCOUNT })
    await expect(movePersonalChat(deps, ctx, account, DIRECT)).resolves.toEqual({ conversationId: CONVERSATION })
    expect(executed).toEqual([])
  })

  it('refuses a room the owner is not in, or with nobody from WhatsApp in it', async () => {
    const { deps, ctx, executed } = setup()
    await expect(movePersonalChat(deps, ctx, account, ELSEWHERE)).resolves.toBeNull()
    await expect(movePersonalChat(deps, ctx, account, MANAGEMENT)).resolves.toBeNull()
    expect(executed).toEqual([])
  })

  it('undoes the move when the bot cannot get in', async () => {
    const { deps, ctx, em, appservice, executed } = setup()
    appservice.failOn = 'join'
    await expect(movePersonalChat(deps, ctx, account, DIRECT)).rejects.toThrow()
    expect(em.rowsOf(ChatMatrixRoom)).toEqual([])
    expect(executed.map((call) => call.commandId)).toContain('chat.conversations.closeExternal')
  })
})

describe('what a moved chat projects', () => {
  it('skips anything said before the move', async () => {
    const { em } = setup()
    const movedAt = new Date('2026-09-30T12:00:00.000Z')
    em.seed(ChatMatrixRoom, { ...scope, roomId: DIRECT, conversationId: CONVERSATION, accountId: ACCOUNT, projectFrom: movedAt })
    const event: MatrixEvent = {
      type: 'm.room.message',
      event_id: '$old',
      sender: GHOST,
      room_id: DIRECT,
      origin_server_ts: movedAt.getTime() - 60_000,
      content: { msgtype: 'm.text', body: 'from last week' },
    }
    const outcome = await projectEvent(
      { em: em.asEntityManager(), config, client: new FakeMatrixClient().asClient(), commandBus: {} as never, container: {} as never },
      event,
      DIRECT,
    )
    expect(outcome).toEqual({ kind: 'skipped', reason: 'before-move' })
  })
})
