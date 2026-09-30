import {
  MatrixClient as MatrixClientExport,
  MatrixError,
  type MatrixConfig,
  type MatrixEvent,
} from '@open-mercato/matrix'
import type { PublishMessageInput } from '@open-mercato/core/modules/chat/lib/transport'
import { createMatrixChatTransport } from '../lib/transport'
import { adoptionHint, adoptPortal, resetAdoptionCache } from '../lib/adoption'
import { actorKey, receiptActor, resolveProjectionActor, withActorOrigin, type OutsiderDeps } from '../lib/outsiders'
import { ChatMatrixAccountLogin, ChatMatrixEvent, ChatMatrixRoom } from '../data/entities'
import { FakeEntityManager, FakeMatrixClient } from './fakes'

/**
 * A company account's WhatsApp chats: how a portal becomes a conversation, who
 * speaks in it, and that replies leave as the account — never as a colleague.
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
const ACCOUNT_MXID = '@om_a_0a0b0c0d111142228333444455556666:operis.local'
const OTHER_ACCOUNT_MXID = '@om_a_ffffffff111142228333444455556666:operis.local'
const PERSONAL_MXID = '@opp_0a0b0c0d111142228333444455556666:operis.local'
const GHOST = '@whatsapp_lid-123456:operis.local'
const GHOST_TWO = '@whatsapp_lid-654321:operis.local'
const BRIDGE_BOT = '@whatsappbot:operis.local'
const BOT = '@om_bot:operis.local'
const PORTAL = '!portal:operis.local'
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const COLLEAGUE = '64097a24-ecb4-4795-80c2-bb466858f186'
const COLLEAGUE_MXID = '@om_u_64097a24ecb4479580c2bb466858f186:operis.local'

const config: MatrixConfig = {
  baseUrl: 'http://synapse:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
  senderLocalpart: 'operis',
  userPrefix: 'om_',
  botLocalpart: 'om_bot',
  bridgeGhosts: [{ network: 'whatsapp', prefix: 'whatsapp_' }],
}

function seedLogin(em: FakeEntityManager, overrides: Record<string, unknown> = {}): void {
  em.seed(ChatMatrixAccountLogin, {
    ...scope,
    accountId: ACCOUNT,
    ownerType: 'company',
    network: 'whatsapp',
    mxid: ACCOUNT_MXID,
    registeredAt: new Date('2026-09-29T10:00:00.000Z'),
    ...overrides,
  })
}

function memberEvent(stateKey: string, membership: string): MatrixEvent {
  return {
    type: 'm.room.member',
    event_id: `$member-${stateKey}-${membership}`,
    sender: BRIDGE_BOT,
    origin_server_ts: 1_700_000_000_000,
    state_key: stateKey,
    content: { membership },
  } as MatrixEvent
}

type Executed = { commandId: string; input: Record<string, unknown>; sub: unknown }

function adoptionHarness() {
  const em = new FakeEntityManager()
  const client = new FakeMatrixClient()
  const executed: Executed[] = []
  const deps: OutsiderDeps = {
    em: em.asEntityManager(),
    commandBus: {
      execute: async (commandId: string, args: { input: Record<string, unknown>; ctx: { auth?: { sub?: unknown } } }) => {
        executed.push({ commandId, input: args.input, sub: args.ctx.auth?.sub })
        return { result: commandId === 'chat.conversations.createExternal' ? { conversationId: CONVERSATION } : {} }
      },
    } as unknown as OutsiderDeps['commandBus'],
    config,
    container: {} as OutsiderDeps['container'],
    client: client.asClient(),
  }
  return { em, client, executed, deps }
}

beforeEach(() => {
  resetAdoptionCache()
  MatrixClient.mockReset()
})

describe('adoptionHint', () => {
  it('names a company account identity joining or being invited', () => {
    const deps = { config }
    expect(adoptionHint(deps, memberEvent(ACCOUNT_MXID, 'join'))).toBe(ACCOUNT_MXID)
    expect(adoptionHint(deps, memberEvent(ACCOUNT_MXID, 'invite'))).toBe(ACCOUNT_MXID)
  })

  it('ignores leaving, colleagues, ghosts and personal identities', () => {
    const deps = { config }
    expect(adoptionHint(deps, memberEvent(ACCOUNT_MXID, 'leave'))).toBeNull()
    expect(adoptionHint(deps, memberEvent(COLLEAGUE_MXID, 'join'))).toBeNull()
    expect(adoptionHint(deps, memberEvent(GHOST, 'join'))).toBeNull()
    // A personal account's portals are never pushed here; if one ever were, it
    // is not something to adopt.
    expect(adoptionHint(deps, memberEvent(PERSONAL_MXID, 'join'))).toBeNull()
  })
})

describe('adoptPortal', () => {
  it('opens a conversation for the account team, with every ghost as a contact', async () => {
    const { em, client, executed, deps } = adoptionHarness()
    seedLogin(em)
    client.joinedByRoom[PORTAL] = {
      [ACCOUNT_MXID]: {},
      [BRIDGE_BOT]: {},
      [GHOST]: { display_name: 'Linh Tran' },
    }

    const room = await adoptPortal(deps, PORTAL, ACCOUNT_MXID)

    expect(room).toMatchObject({ roomId: PORTAL, conversationId: CONVERSATION, accountId: ACCOUNT, state: 'ready' })
    expect(executed.map((call) => call.commandId)).toEqual([
      'chat.externalContacts.ensure',
      'chat.conversations.createExternal',
    ])
    expect(executed[0]!.input).toMatchObject({ ...scope, network: 'whatsapp', displayName: 'Linh Tran' })
    // A one-to-one chat is named after its contact at read time; the team comes
    // from the account, decided by chat.
    expect(executed[1]!.input).toMatchObject({ ...scope, title: null, memberUserIds: [], messagingAccountId: ACCOUNT })
    expect(executed.every((call) => call.sub === undefined)).toBe(true)
    expect(em.rowsOf(ChatMatrixRoom)).toHaveLength(1)
    // The bot is brought in so the /sync reader covers the chat too.
    expect(client.callsTo('invite')[0]!.args).toEqual([PORTAL, BOT, ACCOUNT_MXID])
  })

  it('keeps a group name, and seats every ghost', async () => {
    const { em, client, executed, deps } = adoptionHarness()
    seedLogin(em)
    client.joinedByRoom[PORTAL] = { [ACCOUNT_MXID]: {}, [GHOST]: {}, [GHOST_TWO]: {} }
    client.powerLevelsByRoom[PORTAL] = { name: 'Supplier group' }
    ;(client as unknown as { getStateEvent: unknown }).getStateEvent = async () => ({ name: 'Supplier group' })

    await adoptPortal(deps, PORTAL, ACCOUNT_MXID)

    const created = executed.find((call) => call.commandId === 'chat.conversations.createExternal')
    expect(created!.input.title).toBe('Supplier group')
    expect(created!.input.externalContactIds).toHaveLength(2)
  })

  it('adopts nothing without a contact — the bridge management room — and remembers it', async () => {
    const { em, client, executed, deps } = adoptionHarness()
    seedLogin(em)
    client.joinedByRoom[PORTAL] = { [ACCOUNT_MXID]: {}, [BRIDGE_BOT]: {} }

    await expect(adoptPortal(deps, PORTAL)).resolves.toBeNull()
    await expect(adoptPortal(deps, PORTAL)).resolves.toBeNull()
    expect(executed).toEqual([])
    // The second probe was answered from memory.
    expect(client.callsTo('joinedMembers')).toHaveLength(1)
  })

  it('finds the owner of a portal whose arrival was missed', async () => {
    const { em, client, deps } = adoptionHarness()
    seedLogin(em, { accountId: 'aaaaaaaa-1111-4222-8333-444455556666', mxid: OTHER_ACCOUNT_MXID })
    seedLogin(em)
    client.joinedByRoom[PORTAL] = { [ACCOUNT_MXID]: {}, [GHOST]: {} }

    const room = await adoptPortal(deps, PORTAL)
    expect(room?.accountId).toBe(ACCOUNT)
  })

  it('never adopts a room twice', async () => {
    const { em, executed, deps } = adoptionHarness()
    em.seed(ChatMatrixRoom, { ...scope, roomId: PORTAL, conversationId: CONVERSATION, state: 'ready', accountId: ACCOUNT })
    const room = await adoptPortal(deps, PORTAL, ACCOUNT_MXID)
    expect(room?.conversationId).toBe(CONVERSATION)
    expect(executed).toEqual([])
  })

  it('ignores a room no connected account is in', async () => {
    const { em, client, deps } = adoptionHarness()
    client.joinedByRoom[PORTAL] = { [GHOST]: {} }
    await expect(adoptPortal(deps, PORTAL)).resolves.toBeNull()
    expect(em.rowsOf(ChatMatrixRoom)).toHaveLength(0)
  })
})

describe('the company phone as a sender', () => {
  const portal = { roomId: PORTAL, conversationId: CONVERSATION, accountId: ACCOUNT, ...scope } as ChatMatrixRoom
  const linked = { roomId: '!linked:operis.local', conversationId: CONVERSATION, accountId: null, ...scope } as ChatMatrixRoom

  it('is the account, in its own portal', async () => {
    const { deps, executed } = adoptionHarness()
    await expect(resolveProjectionActor(deps, ACCOUNT_MXID, portal)).resolves.toEqual({
      ok: true,
      actor: { kind: 'account', accountId: ACCOUNT },
    })
    expect(executed).toEqual([])
  })

  it('is nobody anywhere else', async () => {
    const { deps } = adoptionHarness()
    await expect(resolveProjectionActor(deps, ACCOUNT_MXID, linked)).resolves.toEqual({
      ok: false,
      reason: 'external-sender',
    })
    await expect(resolveProjectionActor(deps, OTHER_ACCOUNT_MXID, portal)).resolves.toEqual({
      ok: false,
      reason: 'external-sender',
    })
  })

  it('never reads a phone receipt as a colleague reading', () => {
    expect(receiptActor(config, scope, ACCOUNT_MXID)).toBeNull()
  })

  it('names the account in externalOrigin and keys its reactions apart', () => {
    expect(withActorOrigin({ eventId: '$e' }, { kind: 'account', accountId: ACCOUNT })).toEqual({
      eventId: '$e',
      senderAccountId: ACCOUNT,
    })
    expect(actorKey({ kind: 'account', accountId: ACCOUNT })).toBe(`acct-${ACCOUNT}`)
  })
})

describe('sending in an account chat', () => {
  const message: PublishMessageInput = {
    conversationId: CONVERSATION,
    conversationKind: 'external',
    messageId: '44444444-4444-4444-8444-444444444444',
    senderUserId: COLLEAGUE,
    senderName: 'Jules Martin',
    body: 'Your order ships today.',
    createdAt: new Date('2026-09-29T12:00:00.000Z'),
    replyToMessageId: null,
    clientMessageId: null,
    attachmentIds: [],
    recipientUserIds: [COLLEAGUE],
    senderSignature: 'Jules',
  }

  function transportHarness() {
    const em = new FakeEntityManager()
    const client = new FakeMatrixClient()
    MatrixClient.mockImplementation(() => client)
    em.seed(ChatMatrixRoom, { ...scope, conversationId: CONVERSATION, roomId: PORTAL, state: 'ready', accountId: ACCOUNT })
    seedLogin(em)
    return { em, client, transport: createMatrixChatTransport(config) }
  }

  it('leaves as the account, signed, and never seats the colleague', async () => {
    const { em, client, transport } = transportHarness()
    await transport.publishMessage({ em: em.asEntityManager() }, scope, message)

    const [params] = client.callsTo('sendEvent')[0]!.args as [Record<string, unknown>]
    expect(params.asUser).toBe(ACCOUNT_MXID)
    expect((params.content as Record<string, unknown>).body).toBe('Jules: Your order ships today.')
    expect(client.callsTo('registerUser')).toHaveLength(0)
    expect(client.callsTo('invite')).toHaveLength(0)
  })

  it('sends unsigned when the account does not sign', async () => {
    const { em, client, transport } = transportHarness()
    await transport.publishMessage({ em: em.asEntityManager() }, scope, { ...message, senderSignature: null })
    const [params] = client.callsTo('sendEvent')[0]!.args as [Record<string, unknown>]
    expect((params.content as Record<string, unknown>).body).toBe('Your order ships today.')
  })

  it('accepts an invite the bridge left pending, then sends once more', async () => {
    const { em, client, transport } = transportHarness()
    let first = true
    const send = client.sendEvent.bind(client)
    client.sendEvent = async (params: Record<string, unknown>) => {
      if (first) {
        first = false
        throw new MatrixError({ message: 'not in room', kind: 'permanent', status: 403, errcode: 'M_FORBIDDEN' })
      }
      return send(params)
    }
    await transport.publishMessage({ em: em.asEntityManager() }, scope, message)
    expect(client.callsTo('join')[0]!.args).toEqual([PORTAL, ACCOUNT_MXID])
    expect(client.callsTo('sendEvent')).toHaveLength(1)
  })

  it('types, reads, edits and deletes as the account too', async () => {
    const { em, client, transport } = transportHarness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: message.messageId, eventId: '$sent', conversationId: CONVERSATION, roomId: PORTAL })
    const ctx = { em: em.asEntityManager() }

    await transport.publishTyping(ctx, scope, { conversationId: CONVERSATION, userId: COLLEAGUE, typing: true })
    await transport.publishReadReceipt(ctx, scope, { conversationId: CONVERSATION, userId: COLLEAGUE, messageId: message.messageId })
    await transport.publishEdit(ctx, scope, {
      conversationId: CONVERSATION,
      messageId: message.messageId,
      senderUserId: COLLEAGUE,
      senderName: 'Jules Martin',
      body: 'It ships tomorrow.',
      editedAt: new Date('2026-09-29T12:05:00.000Z'),
      senderSignature: 'Jules',
    })
    await transport.publishDeletion(ctx, scope, {
      conversationId: CONVERSATION,
      messageId: message.messageId,
      actorUserId: COLLEAGUE,
      actorName: 'Jules Martin',
    })

    expect(client.callsTo('setTyping')[0]!.args[1]).toBe(ACCOUNT_MXID)
    expect(client.callsTo('sendReceipt')[0]!.args[2]).toBe(ACCOUNT_MXID)
    const [edit] = client.callsTo('sendEvent')[0]!.args as [Record<string, unknown>]
    expect(edit.asUser).toBe(ACCOUNT_MXID)
    expect((edit.content as { 'm.new_content': { body: string } })['m.new_content'].body).toBe('Jules: It ships tomorrow.')
    const [redaction] = client.callsTo('redact')[0]!.args as [Record<string, unknown>]
    expect(redaction.asUser).toBe(ACCOUNT_MXID)
    expect(client.callsTo('registerUser')).toHaveLength(0)
  })
})
