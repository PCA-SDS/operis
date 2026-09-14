import { ensureRoom, sendAsRoomMember } from '../lib/rooms'
import { ChatMatrixIdentity, ChatMatrixRoom } from '../data/entities'
import { MatrixError } from '@open-mercato/matrix'
import { BOT, FakeEntityManager, FakeMatrixClient, testConfig } from './fakes'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const OWNER = '64097a24-ecb4-4795-80c2-bb466858f186'
const MEMBER = '78dce603-8282-444a-98ad-1c902a01332e'
const OWNER_MXID = '@om_u_64097a24ecb4479580c2bb466858f186:operis.local'
const MEMBER_MXID = '@om_u_78dce6038282444a98ad1c902a01332e:operis.local'

function harness() {
  const em = new FakeEntityManager()
  const client = new FakeMatrixClient()
  return {
    em,
    client,
    deps: { em: em.asEntityManager(), client: client.asClient(), config: testConfig },
  }
}

const input = {
  conversationId: CONVERSATION,
  kind: 'space' as const,
  title: 'Engineering',
  memberUserIds: [OWNER, MEMBER],
  ownerUserIds: [OWNER],
}

describe('ensureRoom', () => {
  it('returns a ready room without creating anything', async () => {
    const { em, client, deps } = harness()
    em.seed(ChatMatrixRoom, { ...scope, conversationId: CONVERSATION, roomId: '!existing:operis.local', state: 'ready' })

    await expect(ensureRoom(deps, scope, input)).resolves.toBe('!existing:operis.local')
    expect(client.calls).toHaveLength(0)
  })

  it('creates the room as the bot, not as a member', async () => {
    // Hard constraint: the creator must hold PL 100 while the room's own state
    // events are written. A room created as an owner and demoted to 50 fails
    // with "user_level (50) < send_level (100)".
    const { client, deps } = harness()
    await ensureRoom(deps, scope, input)

    const [options, asUser] = client.callsTo('createRoom')[0].args as [Record<string, unknown>, string]
    expect(asUser).toBe(BOT)
    const levels = options.powerLevels as { users: Record<string, number>; users_default: number }
    expect(levels.users[BOT]).toBe(100)
    expect(levels.users[OWNER_MXID]).toBe(50)
    expect(levels.users[MEMBER_MXID]).toBeUndefined()
    expect(levels.users_default).toBe(0)
  })

  it('marks a direct conversation as such', async () => {
    const { client, deps } = harness()
    await ensureRoom(deps, scope, { ...input, kind: 'direct', title: null })

    const [options] = client.callsTo('createRoom')[0].args as [Record<string, unknown>]
    expect(options.isDirect).toBe(true)
    expect(options.preset).toBe('trusted_private_chat')
  })

  it('invites and joins every member, then marks the room ready', async () => {
    const { em, client, deps } = harness()
    await expect(ensureRoom(deps, scope, input)).resolves.toBe('!room:operis.local')

    expect(client.callsTo('invite')).toHaveLength(2)
    expect(client.callsTo('join')).toHaveLength(2)
    const [room] = em.rows.get(ChatMatrixRoom) ?? []
    expect(room.state).toBe('ready')
  })

  it('skips members who are already joined', async () => {
    const { client, deps } = harness()
    client.joinedByRoom['!room:operis.local'] = { [OWNER_MXID]: {} }
    await ensureRoom(deps, scope, input)

    expect(client.callsTo('invite')).toHaveLength(1)
    expect(client.callsTo('invite')[0].args[1]).toBe(MEMBER_MXID)
  })

  it('records the failure on the row and rethrows', async () => {
    // `state` must not stay `pending` silently — a send into a half-built room
    // lands somewhere half the conversation cannot read, so the state is what
    // the transport checks.
    const { em, client, deps } = harness()
    client.failOn = 'join'

    await expect(ensureRoom(deps, scope, input)).rejects.toThrow(/fake failure/)
    const [room] = em.rows.get(ChatMatrixRoom) ?? []
    expect(room.state).toBe('failed')
    expect(room.lastError).toMatch(/fake failure/)
  })

  it('resumes a half-provisioned room instead of creating a second one', async () => {
    const { em, client, deps } = harness()
    em.seed(ChatMatrixRoom, { ...scope, conversationId: CONVERSATION, roomId: '!half:operis.local', state: 'pending' })

    await expect(ensureRoom(deps, scope, input)).resolves.toBe('!half:operis.local')
    expect(client.callsTo('createRoom')).toHaveLength(0)
    expect(client.callsTo('join').length).toBeGreaterThan(0)
  })

  it('retries a failed room rather than abandoning the conversation', async () => {
    const { em, client, deps } = harness()
    em.seed(ChatMatrixRoom, { ...scope, conversationId: CONVERSATION, roomId: '!f:operis.local', state: 'failed', lastError: 'earlier' })

    await expect(ensureRoom(deps, scope, input)).resolves.toBe('!f:operis.local')
    expect(client.callsTo('createRoom')).toHaveLength(0)
    const [room] = em.rows.get(ChatMatrixRoom) ?? []
    expect(room.state).toBe('ready')
    expect(room.lastError).toBeNull()
  })

  it('yields to the winner of a creation race', async () => {
    // One conversation must never fan out into two rooms; the unique constraint
    // is what guarantees it, and this is how the loser behaves.
    const { em, deps } = harness()
    // Pre-seeded so identity provisioning short-circuits and the room insert is
    // the first flush — otherwise the fake's failure lands on the wrong write.
    em.seed(ChatMatrixIdentity, { tenantId: scope.tenantId, userId: OWNER, mxid: OWNER_MXID, displayName: null })
    em.seed(ChatMatrixIdentity, { tenantId: scope.tenantId, userId: MEMBER, mxid: MEMBER_MXID, displayName: null })
    em.failNextFlushWithUniqueViolation = true
    em.seedRaced(ChatMatrixRoom, { ...scope, conversationId: CONVERSATION, roomId: '!winner:operis.local', state: 'ready' })

    await expect(ensureRoom(deps, scope, input)).resolves.toBe('!winner:operis.local')
  })
})

describe('sendAsRoomMember', () => {
  const send = {
    roomId: '!room:operis.local',
    eventType: 'm.room.message',
    transactionId: 'om-abc',
    content: { body: 'hi' },
    userId: OWNER,
    asUser: OWNER_MXID,
  }

  it('sends straight through when the author is already in the room', async () => {
    const { client, deps } = harness()
    await expect(sendAsRoomMember(deps, scope.tenantId, send)).resolves.toEqual({
      event_id: '$event',
    })
    expect(client.callsTo('join')).toHaveLength(0)
  })

  it('joins the author and retries when the room refuses them', async () => {
    // Found by backfilling a real database: a room is provisioned from the
    // CURRENT participants, but its history was written by people who have
    // since left the conversation. Their messages are still in the transcript.
    const { client, deps } = harness()
    let attempts = 0
    const realSend = client.sendEvent.bind(client)
    client.sendEvent = async (params: Record<string, unknown>) => {
      attempts += 1
      if (attempts === 1) {
        throw new MatrixError({
          message: 'not in room',
          kind: 'permanent',
          status: 403,
          errcode: 'M_FORBIDDEN',
        })
      }
      return realSend(params)
    }

    await expect(sendAsRoomMember(deps, scope.tenantId, send)).resolves.toEqual({
      event_id: '$event',
    })
    expect(attempts).toBe(2)
    expect(client.callsTo('join')[0].args[1]).toBe(OWNER_MXID)
  })

  it('does not retry a refusal joining cannot fix', async () => {
    const { client, deps } = harness()
    let attempts = 0
    client.sendEvent = async () => {
      attempts += 1
      throw new MatrixError({ message: 'rate limited', kind: 'transient', status: 429 })
    }

    await expect(sendAsRoomMember(deps, scope.tenantId, send)).rejects.toThrow(/rate limited/)
    expect(attempts).toBe(1)
    expect(client.callsTo('join')).toHaveLength(0)
  })
})
