import {
  deriveTransactionId,
  MatrixClient as MatrixClientExport,
  MatrixError,
} from '@open-mercato/matrix'
import type { PublishMessageInput } from '@open-mercato/core/modules/chat/lib/transport'
import { createMatrixChatTransport } from '../lib/transport'
import { ChatMatrixEvent, ChatMatrixIdentity, ChatMatrixRoom } from '../data/entities'
import { FakeEntityManager, FakeMatrixClient, testConfig } from './fakes'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const MESSAGE = '44444444-4444-4444-8444-444444444444'
const PARENT = '55555555-5555-4555-8555-555555555555'
const SENDER = '64097a24-ecb4-4795-80c2-bb466858f186'
const SENDER_MXID = '@om_u_64097a24ecb4479580c2bb466858f186:operis.local'
const ROOM = '!room:operis.local'

const message: PublishMessageInput = {
  conversationId: CONVERSATION,
  conversationKind: 'space',
  messageId: MESSAGE,
  senderUserId: SENDER,
  senderName: 'Bao Nguyen',
  body: 'the quarterly numbers are in',
  createdAt: new Date('2026-09-10T12:00:00.000Z'),
  replyToMessageId: null,
  clientMessageId: null,
  attachmentIds: [],
  recipientUserIds: [SENDER],
}

/**
 * `createMatrixChatTransport` builds its own MatrixClient from the config, so
 * the fake is injected by swapping the constructor for this suite.
 */
jest.mock('@open-mercato/matrix', () => {
  const actual = jest.requireActual('@open-mercato/matrix')
  return { ...actual, MatrixClient: jest.fn() }
})

// `jest.mock` is hoisted above the imports, so the binding above is already the
// mock constructor by the time this runs.
const MatrixClient = MatrixClientExport as unknown as jest.Mock

function harness(options: { roomState?: string } = {}) {
  const em = new FakeEntityManager()
  const client = new FakeMatrixClient()
  MatrixClient.mockImplementation(() => client)

  if (options.roomState !== 'absent') {
    em.seed(ChatMatrixRoom, {
      ...scope,
      conversationId: CONVERSATION,
      roomId: ROOM,
      state: options.roomState ?? 'ready',
    })
  }
  em.seed(ChatMatrixIdentity, {
    tenantId: scope.tenantId,
    userId: SENDER,
    mxid: SENDER_MXID,
    displayName: 'Bao Nguyen',
  })

  return { em, client, transport: createMatrixChatTransport(testConfig) }
}

beforeEach(() => MatrixClient.mockReset())

describe('publishMessage', () => {
  it('sends as the author, not as the bot', async () => {
    const { em, client, transport } = harness()
    await transport.publishMessage({ em: em.asEntityManager() }, scope, message)

    const [params] = client.callsTo('sendEvent')[0].args as [Record<string, unknown>]
    expect(params.asUser).toBe(SENDER_MXID)
    expect(params.roomId).toBe(ROOM)
    expect((params.content as Record<string, unknown>).body).toBe(message.body)
  })

  it('derives the transaction id from the Operis message id', async () => {
    // This is what makes a retried publish return the original event instead of
    // posting a second copy — the shadow writer's whole safety property.
    const { em, client, transport } = harness()
    await transport.publishMessage({ em: em.asEntityManager() }, scope, message)

    const [params] = client.callsTo('sendEvent')[0].args as [Record<string, unknown>]
    expect(params.transactionId).toBe(deriveTransactionId(MESSAGE))
  })

  it('does NOT record the correspondence itself', async () => {
    // Recording is `recordPublication`'s job, because the two happen at
    // different moments once Matrix is authoritative: the publish comes before
    // the message row exists, so there is nothing to correlate yet.
    const { em, transport } = harness()
    const result = await transport.publishMessage({ em: em.asEntityManager() }, scope, message)

    expect(result.externalId).toBe('$event')
    expect(em.rows.get(ChatMatrixEvent) ?? []).toHaveLength(0)
  })

  it.each([
    ['pending', 'pending'],
    ['failed', 'failed'],
  ])('refuses to publish into a %s room', async (_label, roomState) => {
    // A send into a half-built room lands somewhere half the conversation
    // cannot read.
    const { em, client, transport } = harness({ roomState })
    await expect(
      transport.publishMessage({ em: em.asEntityManager() }, scope, message),
    ).rejects.toThrow(/no ready Matrix room/)
    expect(client.callsTo('sendEvent')).toHaveLength(0)
  })

  it('refuses to publish when there is no room at all', async () => {
    const { em, transport } = harness({ roomState: 'absent' })
    await expect(
      transport.publishMessage({ em: em.asEntityManager() }, scope, message),
    ).rejects.toThrow(/absent/)
  })
})

describe('replies', () => {
  it('threads a reply whose parent is mapped', async () => {
    const { em, client, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: PARENT, eventId: '$parent' })

    await transport.publishMessage({ em: em.asEntityManager() }, scope, {
      ...message,
      replyToMessageId: PARENT,
    })

    const [params] = client.callsTo('sendEvent')[0].args as [Record<string, unknown>]
    const content = params.content as Record<string, unknown>
    expect(content['m.relates_to']).toEqual({ 'm.in_reply_to': { event_id: '$parent' } })
  })

  it('sends unthreaded when the parent was never published', async () => {
    // Losing the reply because its parent is unmapped would be worse than
    // losing the threading.
    const { em, client, transport } = harness()

    await transport.publishMessage({ em: em.asEntityManager() }, scope, {
      ...message,
      replyToMessageId: PARENT,
    })

    const [params] = client.callsTo('sendEvent')[0].args as [Record<string, unknown>]
    expect((params.content as Record<string, unknown>)['m.relates_to']).toBeUndefined()
    expect(client.callsTo('sendEvent')).toHaveLength(1)
  })
})

describe('bookkeeping races', () => {
  it('treats a duplicate mapping as success, because the message is already sent', async () => {
    const { em, transport } = harness()
    em.failNextFlushWithUniqueViolation = true

    await expect(
      transport.publishMessage({ em: em.asEntityManager() }, scope, message),
    ).resolves.toEqual({ externalId: '$event' })
  })
})

describe('republishing', () => {
  it('short-circuits on an existing mapping without calling the homeserver', async () => {
    // Found by the end-to-end check: without this the transport made a
    // redundant round trip and then relied on the unique constraint to reject
    // the second mapping row — wasted work on the path the backfill walks in
    // bulk.
    const { em, client, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: MESSAGE, eventId: '$already' })

    await expect(
      transport.publishMessage({ em: em.asEntityManager() }, scope, message),
    ).resolves.toEqual({ externalId: '$already' })
    expect(client.callsTo('sendEvent')).toHaveLength(0)
    expect(em.rows.get(ChatMatrixEvent)).toHaveLength(1)
  })

  it('still publishes a different message in the same conversation', async () => {
    const { em, client, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: PARENT, eventId: '$other' })

    await transport.publishMessage({ em: em.asEntityManager() }, scope, message)
    expect(client.callsTo('sendEvent')).toHaveLength(1)
  })
})

describe('recordPublication', () => {
  it('correlates the message with the event', async () => {
    const { em, transport } = harness()
    await transport.recordPublication({ em: em.asEntityManager() }, scope, {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      externalId: '$event',
      createdAt: message.createdAt,
    })

    const [event] = em.rows.get(ChatMatrixEvent) ?? []
    expect(event.messageId).toBe(MESSAGE)
    expect(event.eventId).toBe('$event')
    expect(event.roomId).toBe(ROOM)
    // Already projected: the Operis row is what was published from, so there is
    // nothing left to project.
    expect(event.projectedAt).toBeInstanceOf(Date)
  })

  it('stamps the message time, not the moment of recording', async () => {
    const { em, transport } = harness()
    await transport.recordPublication({ em: em.asEntityManager() }, scope, {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      externalId: '$event',
      createdAt: message.createdAt,
    })
    const [event] = em.rows.get(ChatMatrixEvent) ?? []
    expect(event.originServerTs).toEqual(message.createdAt)
  })

  it('tolerates a duplicate, because the message is already sent', async () => {
    const { em, transport } = harness()
    em.failNextFlushWithUniqueViolation = true

    await expect(
      transport.recordPublication({ em: em.asEntityManager() }, scope, {
        conversationId: CONVERSATION,
        messageId: MESSAGE,
        externalId: '$event',
        createdAt: message.createdAt,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('mode', () => {
  it('defaults to shadow, the mode where a homeserver outage cannot stop a send', () => {
    expect(createMatrixChatTransport(testConfig).mode).toBe('shadow')
  })

  it('reports authoritative when built that way', () => {
    expect(createMatrixChatTransport(testConfig, 'authoritative').mode).toBe('authoritative')
  })
})

describe('membership drift', () => {
  it('joins a sender the room does not have, then retries once', async () => {
    // `ensureRoom` returns early for a ready room and never revisits membership,
    // so somebody added to an Operis space after its room was built has no
    // Matrix membership. Their first message would otherwise be refused.
    const { em, client, transport } = harness()
    let attempts = 0
    const realSend = client.sendEvent.bind(client)
    client.sendEvent = async (params: Record<string, unknown>) => {
      attempts += 1
      if (attempts === 1) {
        const error = new MatrixError({
          message: 'not in room',
          kind: 'permanent',
          status: 403,
          errcode: 'M_FORBIDDEN',
        })
        throw error
      }
      return realSend(params)
    }

    await expect(
      transport.publishMessage({ em: em.asEntityManager() }, scope, message),
    ).resolves.toEqual({ externalId: '$event' })

    expect(attempts).toBe(2)
    expect(client.callsTo('join')).toHaveLength(1)
    expect(client.callsTo('join')[0].args[1]).toBe(SENDER_MXID)
  })

  it('does not retry a refusal that joining cannot fix', async () => {
    // Bounded to one attempt: if the second send still fails, the problem is
    // something else and must surface rather than loop.
    const { em, client, transport } = harness()
    let attempts = 0
    client.sendEvent = async () => {
      attempts += 1
      throw new MatrixError({
        message: 'still forbidden',
        kind: 'permanent',
        status: 403,
        errcode: 'M_FORBIDDEN',
      })
    }

    await expect(
      transport.publishMessage({ em: em.asEntityManager() }, scope, message),
    ).rejects.toThrow(/still forbidden/)
    expect(attempts).toBe(2)
  })

  it('does not repair a failure that is not a membership problem', async () => {
    const { em, client, transport } = harness()
    let attempts = 0
    client.sendEvent = async () => {
      attempts += 1
      throw new MatrixError({ message: 'rate limited', kind: 'transient', status: 429 })
    }

    await expect(
      transport.publishMessage({ em: em.asEntityManager() }, scope, message),
    ).rejects.toThrow(/rate limited/)
    expect(attempts).toBe(1)
    expect(client.callsTo('join')).toHaveLength(0)
  })
})

describe('mirroring reactions', () => {
  const REACTION = {
    conversationId: CONVERSATION,
    messageId: MESSAGE,
    userId: SENDER,
    emoji: '👍',
  }
  const KEY = `reaction:${MESSAGE}:${SENDER}:👍`

  it('sends an m.annotation pointing at the message event', async () => {
    const { em, client, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: MESSAGE, eventId: '$target' })

    await transport.publishReaction({ em: em.asEntityManager() }, scope, {
      ...REACTION,
      added: true,
    })

    const [params] = client.callsTo('sendEvent')[0].args as [Record<string, unknown>]
    expect(params.eventType).toBe('m.reaction')
    expect(params.asUser).toBe(SENDER_MXID)
    expect((params.content as Record<string, unknown>)['m.relates_to']).toEqual({
      rel_type: 'm.annotation',
      event_id: '$target',
      key: '👍',
    })
  })

  it('records the mapping under a key that outlives the Operis row', async () => {
    // The chat_message_reactions row is DELETED on un-react, so the mapping
    // cannot be keyed on it. Without this the annotation could never be redacted.
    const { em, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: MESSAGE, eventId: '$target' })

    await transport.publishReaction({ em: em.asEntityManager() }, scope, {
      ...REACTION,
      added: true,
    })

    const mapped = (em.rows.get(ChatMatrixEvent) ?? []).find((row) => row.subjectKey === KEY)
    expect(mapped).toBeDefined()
    expect(mapped?.eventType).toBe('m.reaction')
    // Null so the drift check, which counts messages, does not see a reaction.
    expect(mapped?.messageId).toBeNull()
  })

  it('redacts the annotation when the reaction is taken back', async () => {
    const { em, client, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, subjectKey: KEY, eventId: '$annotation' })

    await transport.publishReaction({ em: em.asEntityManager() }, scope, {
      ...REACTION,
      added: false,
    })

    const [params] = client.callsTo('redact')[0].args as [Record<string, unknown>]
    expect(params.eventId).toBe('$annotation')
    expect(params.asUser).toBe(SENDER_MXID)
    // And the mapping goes with it, so re-reacting mirrors afresh.
    expect((em.rows.get(ChatMatrixEvent) ?? []).some((row) => row.subjectKey === KEY)).toBe(false)
  })

  it('does not annotate twice for a repeated add', async () => {
    // The homeserver would accept a second annotation and then show it twice.
    const { em, client, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: MESSAGE, eventId: '$target' })
    em.seed(ChatMatrixEvent, { ...scope, subjectKey: KEY, eventId: '$annotation' })

    await transport.publishReaction({ em: em.asEntityManager() }, scope, {
      ...REACTION,
      added: true,
    })
    expect(client.callsTo('sendEvent')).toHaveLength(0)
  })

  it('is a no-op when there is nothing mirrored to redact', async () => {
    const { em, client, transport } = harness()
    await expect(
      transport.publishReaction({ em: em.asEntityManager() }, scope, { ...REACTION, added: false }),
    ).resolves.toBeUndefined()
    expect(client.callsTo('redact')).toHaveLength(0)
  })

  it('skips when the message it reacts to was never published', async () => {
    // Reacting to an event the room does not have is not possible. The backfill
    // brings the message across; the reaction can follow.
    const { em, client, transport } = harness()
    await transport.publishReaction({ em: em.asEntityManager() }, scope, {
      ...REACTION,
      added: true,
    })
    expect(client.callsTo('sendEvent')).toHaveLength(0)
  })

  it('skips when the room is not ready', async () => {
    const { em, client, transport } = harness({ roomState: 'pending' })
    em.seed(ChatMatrixEvent, { ...scope, messageId: MESSAGE, eventId: '$target' })

    await expect(
      transport.publishReaction({ em: em.asEntityManager() }, scope, { ...REACTION, added: true }),
    ).resolves.toBeUndefined()
    expect(client.callsTo('sendEvent')).toHaveLength(0)
  })
})

describe('the reaction transaction id', () => {
  it('is NOT derived from the reaction tuple', async () => {
    // Found end-to-end against a real homeserver: a tuple-derived id does not
    // change when a reaction is taken back and re-applied, so the second
    // m.reaction carries the first one's transaction id and the homeserver
    // returns the REDACTED event. Re-reacting became a permanent no-op.
    //
    // Idempotency lives in chat_matrix_events_subject_uq instead, which is a
    // stronger guard because it survives a process restart.
    const seen = new Set<string>()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { em, client, transport } = harness()
      em.seed(ChatMatrixEvent, { ...scope, messageId: MESSAGE, eventId: '$target' })
      await transport.publishReaction({ em: em.asEntityManager() }, scope, {
        conversationId: CONVERSATION,
        messageId: MESSAGE,
        userId: SENDER,
        emoji: '👍',
        added: true,
      })
      const [params] = client.callsTo('sendEvent')[0].args as [Record<string, unknown>]
      seen.add(params.transactionId as string)
    }

    expect(seen.size).toBe(3)
  })

  it('is still URL-path safe', async () => {
    const { em, client, transport } = harness()
    em.seed(ChatMatrixEvent, { ...scope, messageId: MESSAGE, eventId: '$target' })
    await transport.publishReaction({ em: em.asEntityManager() }, scope, {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      userId: SENDER,
      // An emoji in the key must not escape into the URL path unencoded.
      emoji: '👍',
      added: true,
    })
    const [params] = client.callsTo('sendEvent')[0].args as [Record<string, unknown>]
    const txn = params.transactionId as string
    expect(txn).toMatch(/^om-[0-9a-f]{32}$/)
    expect(encodeURIComponent(txn)).toBe(txn)
  })
})

describe('publishEdit', () => {
  const edit = {
    conversationId: CONVERSATION,
    messageId: MESSAGE,
    senderUserId: SENDER,
    senderName: 'Bao Nguyen',
    body: 'the quarterly numbers are in, revised',
    editedAt: new Date('2026-09-10T12:05:00.000Z'),
  }

  function mapped(em: FakeEntityManager, eventId = '$original') {
    em.seed(ChatMatrixEvent, {
      ...scope,
      messageId: MESSAGE,
      conversationId: CONVERSATION,
      roomId: ROOM,
      eventId,
      eventType: 'm.room.message',
    })
  }

  it('sends an m.replace carrying the new content', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishEdit({ em: em.asEntityManager() }, scope, edit)

    const [sent] = client.callsTo('sendEvent')
    const params = sent!.args[0] as Record<string, unknown>
    const content = params.content as Record<string, unknown>
    expect(params.eventType).toBe('m.room.message')
    expect(content['m.relates_to']).toEqual({ rel_type: 'm.replace', event_id: '$original' })
    expect(content['m.new_content']).toEqual({ msgtype: 'm.text', body: edit.body })
  })

  it('prefixes the fallback body, for clients that do not understand edits', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishEdit({ em: em.asEntityManager() }, scope, edit)

    const content = (client.callsTo('sendEvent')[0]!.args[0] as Record<string, unknown>)
      .content as Record<string, unknown>
    // Such a client renders the edit as a new message reading "* corrected
    // text" rather than dropping it entirely.
    expect(content.body).toBe(`* ${edit.body}`)
  })

  it('sends as the author, who is the only person allowed to rewrite a body', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishEdit({ em: em.asEntityManager() }, scope, edit)

    expect((client.callsTo('sendEvent')[0]!.args[0] as Record<string, unknown>).asUser).toBe(
      SENDER_MXID,
    )
  })

  /**
   * The reaction bug in a different costume, and the reason the transaction id
   * carries `editedAt`.
   *
   * Keyed on the message alone, a second edit would carry the first one's
   * transaction id — and the homeserver, being idempotent on that key, would
   * hand back the FIRST edit's event. Every edit after the first would be a
   * permanent no-op that looks like a success.
   */
  it('gives each edit of one message a different transaction id', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishEdit({ em: em.asEntityManager() }, scope, edit)
    await transport.publishEdit({ em: em.asEntityManager() }, scope, {
      ...edit,
      body: 'and again',
      editedAt: new Date('2026-09-10T12:09:00.000Z'),
    })

    const ids = client
      .callsTo('sendEvent')
      .map((call) => (call.args[0] as Record<string, unknown>).transactionId)
    expect(ids[0]).not.toEqual(ids[1])
  })

  it('gives a retry of the SAME edit the same transaction id', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishEdit({ em: em.asEntityManager() }, scope, edit)
    await transport.publishEdit({ em: em.asEntityManager() }, scope, { ...edit })

    const ids = client
      .callsTo('sendEvent')
      .map((call) => (call.args[0] as Record<string, unknown>).transactionId)
    // Deterministic, so a retry after a timeout resolves to the event the first
    // attempt produced instead of posting a second edit.
    expect(ids[0]).toEqual(ids[1])
  })

  it('does nothing for a message the room never received', async () => {
    const { em, client, transport } = harness()
    // No mapping row: the message predates the transport, or its publish failed.
    await transport.publishEdit({ em: em.asEntityManager() }, scope, edit)
    expect(client.callsTo('sendEvent')).toHaveLength(0)
  })

  it('does nothing when the room is not ready', async () => {
    const { em, client, transport } = harness({ roomState: 'pending' })
    mapped(em)
    await transport.publishEdit({ em: em.asEntityManager() }, scope, edit)
    expect(client.callsTo('sendEvent')).toHaveLength(0)
  })
})

describe('publishDeletion', () => {
  const deletion = {
    conversationId: CONVERSATION,
    messageId: MESSAGE,
    actorUserId: SENDER,
    actorName: 'Bao Nguyen',
  }

  function mapped(em: FakeEntityManager) {
    em.seed(ChatMatrixEvent, {
      ...scope,
      messageId: MESSAGE,
      conversationId: CONVERSATION,
      roomId: ROOM,
      eventId: '$original',
      eventType: 'm.room.message',
    })
  }

  it('redacts the original event', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishDeletion({ em: em.asEntityManager() }, scope, deletion)

    const params = client.callsTo('redact')[0]!.args[0] as Record<string, unknown>
    expect(params.roomId).toBe(ROOM)
    expect(params.eventId).toBe('$original')
  })

  /**
   * As the actor, not as the bot. The author may always redact their own event
   * and a space owner sits at power level 50 — the room's `redact` level — so
   * the homeserver enforces the same rule Operis does, and the room records who
   * removed the message rather than attributing it to the service account.
   */
  it('redacts as the person who pressed delete', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishDeletion({ em: em.asEntityManager() }, scope, deletion)

    expect((client.callsTo('redact')[0]!.args[0] as Record<string, unknown>).asUser).toBe(
      SENDER_MXID,
    )
  })

  it('derives the transaction id from the event, so a retry redacts nothing twice', async () => {
    const { em, client, transport } = harness()
    mapped(em)

    await transport.publishDeletion({ em: em.asEntityManager() }, scope, deletion)
    await transport.publishDeletion({ em: em.asEntityManager() }, scope, deletion)

    const ids = client
      .callsTo('redact')
      .map((call) => (call.args[0] as Record<string, unknown>).transactionId)
    expect(ids[0]).toEqual(ids[1])
  })

  /**
   * Left in place on purpose: it is what a reconciliation would use to check
   * that the redaction landed, and removing it would make the backfill treat the
   * message as never published.
   */
  it('keeps the mapping row', async () => {
    const { em, transport } = harness()
    mapped(em)

    await transport.publishDeletion({ em: em.asEntityManager() }, scope, deletion)

    expect(em.rows.get(ChatMatrixEvent)).toHaveLength(1)
  })

  it('does nothing for a message the room never received', async () => {
    const { em, client, transport } = harness()
    await transport.publishDeletion({ em: em.asEntityManager() }, scope, deletion)
    expect(client.callsTo('redact')).toHaveLength(0)
  })
})
