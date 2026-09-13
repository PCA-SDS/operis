import { parseMatrixEvent } from '@open-mercato/matrix'
import { projectEvent, type ProjectionDeps } from '../lib/projection'
import { ChatMatrixEvent, ChatMatrixRoom } from '../data/entities'
import { FakeEntityManager, testConfig } from './fakes'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const ROOM = '!room:operis.local'
const SENDER = '64097a24-ecb4-4795-80c2-bb466858f186'
const SENDER_MXID = '@om_u_64097a24ecb4479580c2bb466858f186:operis.local'
const PROJECTED_MESSAGE = '99999999-9999-4999-8999-999999999999'

type Executed = { id: string; input: Record<string, unknown>; ctx: Record<string, unknown> }

function harness(options: { withRoom?: boolean } = {}) {
  const em = new FakeEntityManager()
  const executed: Executed[] = []

  if (options.withRoom !== false) {
    em.seed(ChatMatrixRoom, { ...scope, conversationId: CONVERSATION, roomId: ROOM, state: 'ready' })
  }

  const commandBus = {
    async execute(id: string, args: { input: Record<string, unknown>; ctx: Record<string, unknown> }) {
      executed.push({ id, input: args.input, ctx: args.ctx })
      return { result: { message: { id: PROJECTED_MESSAGE }, deduplicated: false } }
    },
  }

  const deps: ProjectionDeps = {
    em: em.asEntityManager(),
    commandBus: commandBus as unknown as ProjectionDeps['commandBus'],
    config: testConfig,
    container: {} as ProjectionDeps['container'],
  }
  return { em, executed, deps }
}

const event = (overrides: Record<string, unknown> = {}) =>
  parseMatrixEvent({
    type: 'm.room.message',
    event_id: '$abc',
    sender: SENDER_MXID,
    origin_server_ts: 1_772_000_000_000,
    room_id: ROOM,
    content: { msgtype: 'm.text', body: 'projected from matrix' },
    ...overrides,
  })!

describe('echo suppression', () => {
  it('skips an event that already has a mapping', async () => {
    // A message Operis sent has a mapping row written in the same transaction
    // that created it, so its own echo is recognised here without a second
    // heuristic — and so is a redelivered event.
    const { em, executed, deps } = harness()
    em.seed(ChatMatrixEvent, { ...scope, eventId: '$abc', messageId: PROJECTED_MESSAGE })

    await expect(projectEvent(deps, event(), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'already-known',
    })
    expect(executed).toHaveLength(0)
  })
})

describe('what it declines to project', () => {
  it.each([
    ['a state event', { type: 'm.room.member', state_key: SENDER_MXID }, 'not-a-message'],
    ['a reaction', { type: 'm.reaction' }, 'not-a-message'],
    ['a redacted message', { content: {} }, 'redacted'],
    ['an empty body', { content: { msgtype: 'm.text', body: '' } }, 'empty-body'],
    /**
     * An edit arrives as an ordinary `m.room.message` whose fallback body reads
     * `* corrected text`. Without this it becomes a duplicate message in the
     * transcript, carrying an asterisk.
     */
    [
      'an edit of an existing message',
      {
        content: {
          msgtype: 'm.text',
          body: '* corrected from matrix',
          'm.new_content': { msgtype: 'm.text', body: 'corrected from matrix' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
        },
      },
      'edit',
    ],
    /** Even a malformed one: it is still an edit and still not a new message. */
    [
      'an edit missing its new content',
      {
        content: {
          msgtype: 'm.text',
          body: '* corrected',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
        },
      },
      'edit',
    ],
  ])('skips %s', async (_label, overrides, reason) => {
    const { executed, deps } = harness()
    await expect(projectEvent(deps, event(overrides as Record<string, unknown>), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason,
    })
    expect(executed).toHaveLength(0)
  })

  /**
   * The skip is on `rel_type: m.replace` alone, so relations that ARE new
   * messages keep projecting. A reply carries no `rel_type` at all.
   */
  it('still projects a rich reply, which carries a relation but is a message', async () => {
    const { executed, deps } = harness()
    const outcome = await projectEvent(
      deps,
      event({
        content: {
          msgtype: 'm.text',
          body: 'agreed',
          'm.relates_to': { 'm.in_reply_to': { event_id: '$parent' } },
        },
      }),
      ROOM,
    )
    expect(outcome.kind).toBe('projected')
    expect(executed).toHaveLength(1)
  })

  it('skips a room Operis never created', async () => {
    // The bot may have been invited to something. Reading it into a
    // conversation nobody authorized would be the actual bug.
    const { executed, deps } = harness({ withRoom: false })
    await expect(projectEvent(deps, event(), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'unmapped-room',
    })
    expect(executed).toHaveLength(0)
  })

  it.each([
    ['the appservice bot', '@om_bot:operis.local'],
    ['a real homeserver account', '@alice:operis.local'],
    ['a bridged external contact', '@whatsapp_6591234567:operis.local'],
  ])('skips a message from %s', async (_label, sender) => {
    // Not an Operis identity. The bridged case is real work — it needs an
    // external-participant model the chat schema does not have — and guessing
    // would attribute somebody else's words to an employee.
    const { executed, deps } = harness()
    await expect(projectEvent(deps, event({ sender }), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'external-sender',
    })
    expect(executed).toHaveLength(0)
  })
})

describe('projecting a message', () => {
  it('replays it through chat.messages.send rather than writing rows', async () => {
    // Writing `chat_messages` directly would skip mention validation, the search
    // document, the link index and the conversation preview — every invariant
    // the chat module enforces in exactly one place.
    const { executed, deps } = harness()
    await expect(projectEvent(deps, event(), ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(executed).toHaveLength(1)
    expect(executed[0].id).toBe('chat.messages.send')
  })

  it('marks the event as the origin so it is not published straight back', async () => {
    const { executed, deps } = harness()
    await projectEvent(deps, event(), ROOM)

    const origin = executed[0].input.externalOrigin as Record<string, unknown>
    expect(origin.eventId).toBe('$abc')
    expect(origin.messageId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('carries the conversation and scope from the room mapping', async () => {
    const { executed, deps } = harness()
    await projectEvent(deps, event(), ROOM)

    expect(executed[0].input).toMatchObject({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      conversationId: CONVERSATION,
      body: 'projected from matrix',
    })
  })

  it("uses the homeserver's timestamp, not the moment it was read", async () => {
    // Stamping with read time would order a drained backlog by when the loop
    // caught up rather than by when things were said.
    const { executed, deps } = harness()
    await projectEvent(deps, event(), ROOM)

    const origin = executed[0].input.externalOrigin as { createdAt: Date }
    expect(origin.createdAt).toEqual(new Date(1_772_000_000_000))
  })

  it('takes authorship from the event sender, never from the payload', async () => {
    // The sender is a namespaced identity only the appservice can mint, so the
    // server still decides authorship — exactly as it does on the HTTP path.
    const { executed, deps } = harness()
    await projectEvent(deps, event(), ROOM)

    const auth = executed[0].ctx.auth as { sub: string }
    expect(auth.sub).toBe(SENDER)
    expect(executed[0].input.senderUserId).toBeUndefined()
  })
})

describe('replies', () => {
  it('resolves the parent through the mapping', async () => {
    const { em, executed, deps } = harness()
    em.seed(ChatMatrixEvent, { ...scope, eventId: '$parent', messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })

    await projectEvent(
      deps,
      event({
        content: {
          msgtype: 'm.text',
          body: 'a reply',
          'm.relates_to': { 'm.in_reply_to': { event_id: '$parent' } },
        },
      }),
      ROOM,
    )
    expect(executed[0].input.replyToMessageId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })

  it('projects unthreaded when the parent is unknown', async () => {
    // Dropping the message because its parent is unmapped would lose more than
    // the threading does.
    const { executed, deps } = harness()

    await projectEvent(
      deps,
      event({
        content: {
          msgtype: 'm.text',
          body: 'a reply',
          'm.relates_to': { 'm.in_reply_to': { event_id: '$missing' } },
        },
      }),
      ROOM,
    )
    expect(executed).toHaveLength(1)
    expect(executed[0].input.replyToMessageId).toBeUndefined()
  })
})

describe('our own orphans', () => {
  it('does not resurrect an Operis message whose send never committed', async () => {
    // In authoritative mode the publish precedes the transaction. A failed
    // commit leaves the event here with no mapping — and the user, shown an
    // error, has already retried. Projecting it would duplicate their message.
    const { executed, deps } = harness()

    await expect(
      projectEvent(
        deps,
        event({ content: { msgtype: 'm.text', body: 'never committed', 'om.origin': 'operis' } }),
        ROOM,
      ),
    ).resolves.toEqual({ kind: 'skipped', reason: 'operis-orphan' })
    expect(executed).toHaveLength(0)
  })

  it('still projects a message that carries no Operis marker', async () => {
    const { executed, deps } = harness()
    await expect(projectEvent(deps, event(), ROOM)).resolves.toMatchObject({ kind: 'projected' })
    expect(executed).toHaveLength(1)
  })

  it('prefers the mapping over the marker for a message that DID commit', async () => {
    // Both would skip, but for different reasons, and the mapping is the
    // stronger statement: this event is already a message.
    const { em, deps } = harness()
    em.seed(ChatMatrixEvent, { ...scope, eventId: '$abc', messageId: PROJECTED_MESSAGE })

    await expect(
      projectEvent(
        deps,
        event({ content: { msgtype: 'm.text', body: 'committed', 'om.origin': 'operis' } }),
        ROOM,
      ),
    ).resolves.toEqual({ kind: 'skipped', reason: 'already-known' })
  })
})
