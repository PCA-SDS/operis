import { parseMatrixEvent } from '@open-mercato/matrix'
import { projectEvent, projectReceipts, type ProjectionDeps } from '../lib/projection'
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

function harness(
  options: { withRoom?: boolean; refuse?: boolean; mediaFails?: boolean; container?: unknown } = {},
) {
  const em = new FakeEntityManager()
  const executed: Executed[] = []

  if (options.withRoom !== false) {
    em.seed(ChatMatrixRoom, { ...scope, conversationId: CONVERSATION, roomId: ROOM, state: 'ready' })
  }

  const commandBus = {
    async execute(id: string, args: { input: Record<string, unknown>; ctx: Record<string, unknown> }) {
      executed.push({ id, input: args.input, ctx: args.ctx })
      if (options.refuse) throw new Error('the chat module refused this actor')
      return { result: { message: { id: PROJECTED_MESSAGE }, deduplicated: false } }
    },
  }

  /** Only what projection reaches for: the media download. */
  const downloads: string[] = []
  const client = {
    async downloadMedia(serverName: string, mediaId: string) {
      downloads.push(`mxc://${serverName}/${mediaId}`)
      if (options.mediaFails) throw new Error('the homeserver lost the file')
      return new Response(Buffer.from('probe-bytes')) as never
    },
  } as unknown as ProjectionDeps['client']

  const deps: ProjectionDeps = {
    em: em.asEntityManager(),
    commandBus: commandBus as unknown as ProjectionDeps['commandBus'],
    config: testConfig,
    container: options.container as ProjectionDeps['container'],
    client,
  }
  return { em, executed, deps, downloads }
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
     * An edit of a message the room has and Operis does not. Nothing to rewrite
     * — and inventing a message from an edit would put the `* corrected text`
     * fallback into the transcript as if it were something someone said.
     */
    [
      'an edit of a message with no mapping',
      {
        content: {
          msgtype: 'm.text',
          body: '* corrected from matrix',
          'm.new_content': { msgtype: 'm.text', body: 'corrected from matrix' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
        },
      },
      'unmapped-target',
    ],
    /** A malformed edit carries no new body, so there is nothing to apply. */
    [
      'an edit missing its new content',
      {
        content: {
          msgtype: 'm.text',
          body: '* corrected',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
        },
      },
      'not-a-message',
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

/**
 * A relation changes a message that already exists, so every one of these
 * resolves its target through the mapping table and replays the change through
 * the command that owns the rule. None of them writes a `chat_*` row here.
 */
describe('projecting a relation from a Matrix client', () => {
  const ORIGINAL_EVENT = '$original'
  const ANNOTATION_EVENT = '$annotation'

  /** The message the relation points at, already mirrored. */
  function withMappedMessage(h: ReturnType<typeof harness>) {
    h.em.seed(ChatMatrixEvent, {
      ...scope,
      eventId: ORIGINAL_EVENT,
      messageId: PROJECTED_MESSAGE,
      conversationId: CONVERSATION,
      roomId: ROOM,
    })
  }

  const reaction = (overrides: Record<string, unknown> = {}) =>
    parseMatrixEvent({
      type: 'm.reaction',
      event_id: ANNOTATION_EVENT,
      sender: SENDER_MXID,
      origin_server_ts: 1_772_000_000_000,
      room_id: ROOM,
      content: {
        'm.relates_to': { rel_type: 'm.annotation', event_id: ORIGINAL_EVENT, key: '🎯' },
      },
      ...overrides,
    })!

  const redactionOf = (target: string, sender = SENDER_MXID) =>
    parseMatrixEvent({
      type: 'm.room.redaction',
      event_id: '$redaction',
      sender,
      origin_server_ts: 1_772_000_001_000,
      room_id: ROOM,
      redacts: target,
      content: {},
    })!

  const editOf = (target: string, body = 'corrected from matrix', extra: Record<string, unknown> = {}) =>
    parseMatrixEvent({
      type: 'm.room.message',
      event_id: '$edit',
      sender: SENDER_MXID,
      origin_server_ts: 1_772_000_002_000,
      room_id: ROOM,
      content: {
        msgtype: 'm.text',
        body: `* ${body}`,
        'm.new_content': { msgtype: 'm.text', body },
        'm.relates_to': { rel_type: 'm.replace', event_id: target },
        ...extra,
      },
    })!

  it('turns an annotation into a reaction on the mapped message', async () => {
    const h = harness()
    withMappedMessage(h)

    await expect(projectEvent(h.deps, reaction(), ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(h.executed).toHaveLength(1)
    expect(h.executed[0].id).toBe('chat.messages.toggleReaction')
    expect(h.executed[0].input).toMatchObject({
      conversationId: CONVERSATION,
      messageId: PROJECTED_MESSAGE,
      emoji: '🎯',
      externalOrigin: { eventId: ANNOTATION_EVENT, reacted: true },
    })
  })

  /**
   * The whole reason the mapping is written first. `publishReaction` returns
   * early when a row exists for the subject key, so recording it before the
   * command runs is what stops the reaction being sent straight back out.
   */
  it('claims the reaction subject key before running the command', async () => {
    const h = harness()
    withMappedMessage(h)
    await projectEvent(h.deps, reaction(), ROOM)

    const mapped = h.em.rowsOf(ChatMatrixEvent).find((row) => row.eventId === ANNOTATION_EVENT)
    expect(mapped?.subjectKey).toBe(`reaction:${PROJECTED_MESSAGE}:${SENDER}:🎯`)
    expect(mapped?.messageId ?? null).toBeNull()
  })

  it('gives the claim back when the chat module refuses the reaction', async () => {
    // Leaving it would tell the mirror a reaction exists that Operis declined
    // to store, and the annotation could then never be redacted.
    const h = harness({ refuse: true })
    withMappedMessage(h)

    await expect(projectEvent(h.deps, reaction(), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'not-permitted',
    })
    expect(h.em.rowsOf(ChatMatrixEvent).some((row) => row.eventId === ANNOTATION_EVENT)).toBe(false)
  })

  it('skips a reaction on a message it has no mapping for', async () => {
    const h = harness()
    await expect(projectEvent(h.deps, reaction(), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'unmapped-target',
    })
    expect(h.executed).toHaveLength(0)
  })

  /** Matrix has no un-react: taking one back is redacting the annotation. */
  it('turns a redacted annotation back into an un-react', async () => {
    const h = harness()
    withMappedMessage(h)
    h.em.seed(ChatMatrixEvent, {
      ...scope,
      eventId: ANNOTATION_EVENT,
      messageId: null,
      subjectKey: `reaction:${PROJECTED_MESSAGE}:${SENDER}:🎯`,
      conversationId: CONVERSATION,
      roomId: ROOM,
    })

    await expect(projectEvent(h.deps, redactionOf(ANNOTATION_EVENT), ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(h.executed[0].input).toMatchObject({
      emoji: '🎯',
      externalOrigin: { reacted: false },
    })
    // The subject key has to be free again so a later re-react can claim it.
    expect(h.em.rowsOf(ChatMatrixEvent).some((row) => row.eventId === ANNOTATION_EVENT)).toBe(false)
  })

  it('refuses to take back somebody else reaction', async () => {
    // A room moderator may redact anyone's annotation; Operis has no such
    // concept, and removing a reaction on someone's behalf would invent one.
    const h = harness()
    withMappedMessage(h)
    h.em.seed(ChatMatrixEvent, {
      ...scope,
      eventId: ANNOTATION_EVENT,
      messageId: null,
      subjectKey: `reaction:${PROJECTED_MESSAGE}:${SENDER}:🎯`,
      conversationId: CONVERSATION,
      roomId: ROOM,
    })

    const other = '@om_u_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa:operis.local'
    await expect(projectEvent(h.deps, redactionOf(ANNOTATION_EVENT, other), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'not-permitted',
    })
    expect(h.executed).toHaveLength(0)
  })

  it('turns a redacted message into a deletion', async () => {
    const h = harness()
    withMappedMessage(h)

    await expect(projectEvent(h.deps, redactionOf(ORIGINAL_EVENT), ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(h.executed[0].id).toBe('chat.messages.delete')
    expect(h.executed[0].input).toMatchObject({
      messageId: PROJECTED_MESSAGE,
      externalOrigin: { eventId: '$redaction' },
    })
  })

  it('skips a redaction of something it never mirrored', async () => {
    // Includes our own un-react echo: the mirror deletes the mapping as it
    // redacts, so by the time the loop reads the redaction there is nothing left
    // to point at.
    const h = harness()
    await expect(projectEvent(h.deps, redactionOf('$unknown'), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'unmapped-target',
    })
    expect(h.executed).toHaveLength(0)
  })

  it('applies an edit from the new content, never from the asterisk fallback', async () => {
    const h = harness()
    withMappedMessage(h)

    await expect(projectEvent(h.deps, editOf(ORIGINAL_EVENT), ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(h.executed[0].id).toBe('chat.messages.edit')
    expect(h.executed[0].input).toMatchObject({
      messageId: PROJECTED_MESSAGE,
      body: 'corrected from matrix',
      externalOrigin: { eventId: '$edit' },
    })
  })

  it('does not re-apply our own edit echoed back', async () => {
    // `publishEdit` records no mapping of its own — the mapping belongs to the
    // message, not to each revision — so the `already-known` gate cannot catch
    // this one and the origin marker has to.
    const h = harness()
    withMappedMessage(h)

    await expect(
      projectEvent(h.deps, editOf(ORIGINAL_EVENT, 'ours', { 'om.origin': 'operis' }), ROOM),
    ).resolves.toEqual({ kind: 'skipped', reason: 'operis-orphan' })
    expect(h.executed).toHaveLength(0)
  })

  it('lets the chat module refuse an edit by someone who is not the author', async () => {
    const h = harness({ refuse: true })
    withMappedMessage(h)

    await expect(projectEvent(h.deps, editOf(ORIGINAL_EVENT), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'not-permitted',
    })
  })

  it('records the event so a redelivery is recognised', async () => {
    const h = harness()
    withMappedMessage(h)
    await projectEvent(h.deps, editOf(ORIGINAL_EVENT), ROOM)

    await expect(projectEvent(h.deps, editOf(ORIGINAL_EVENT), ROOM)).resolves.toEqual({
      kind: 'skipped',
      reason: 'already-known',
    })
    expect(h.executed).toHaveLength(1)
  })
})

/**
 * A file posted in a Matrix client. The bytes are COPIED into Operis' own
 * store, never linked from Synapse — serving a bridged file straight from the
 * homeserver would put it outside `scan_status`, which is the one thing chat's
 * attachment design refuses to allow.
 */
describe('projecting a file posted in a Matrix client', () => {
  const MXC = 'mxc://operis.local/abc123'
  const ATTACHMENT = '77777777-7777-4777-8777-777777777777'

  /** A container whose upload service answers the way the real one does. */
  function uploadingContainer(scanStatus = 'clean') {
    const uploads: Array<Record<string, unknown>> = []
    return {
      uploads,
      container: {
        resolve(name: string) {
          if (name !== 'attachmentScopedUploadService') throw new Error(`no ${name}`)
          return {
            async upload(payload: Record<string, unknown>) {
              uploads.push(payload)
              return { id: ATTACHMENT, scanStatus }
            },
          }
        },
      },
    }
  }

  const imageEvent = (overrides: Record<string, unknown> = {}) =>
    parseMatrixEvent({
      type: 'm.room.message',
      event_id: '$image',
      sender: SENDER_MXID,
      origin_server_ts: 1_772_000_000_000,
      room_id: ROOM,
      content: {
        msgtype: 'm.image',
        body: 'holiday.png',
        url: MXC,
        info: { mimetype: 'image/png', size: 11 },
        ...overrides,
      },
    })!

  it('downloads the file and links it to the projected message', async () => {
    const { container } = uploadingContainer()
    const h = harness({ container })

    await expect(projectEvent(h.deps, imageEvent(), ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(h.downloads).toEqual([MXC])
    expect(h.executed[0].input.attachmentIds).toEqual([ATTACHMENT])
  })

  it('stages it as a draft owned by the sender, in the right conversation', async () => {
    // `linkDraftAttachmentsToMessage` refuses a draft whose uploader is not the
    // person sending, so getting either of these wrong loses the file.
    const { container, uploads } = uploadingContainer()
    const h = harness({ container })
    await projectEvent(h.deps, imageEvent(), ROOM)

    expect(uploads[0]).toMatchObject({
      entityId: 'chat:chat_message_draft',
      recordId: CONVERSATION,
      fileName: 'holiday.png',
      declaredMimeType: 'image/png',
    })
    const metadata = uploads[0].metadata as Record<string, unknown>
    expect(metadata.chat).toMatchObject({ uploaderUserId: SENDER, conversationId: CONVERSATION })
  })

  it.each([
    ['m.file', 'contract.pdf', 'application/pdf'],
    ['m.video', 'clip.mp4', 'video/mp4'],
    ['m.audio', 'note.ogg', 'audio/ogg'],
  ])('brings a %s across too', async (msgtype, fileName, mimetype) => {
    const { container, uploads } = uploadingContainer()
    const h = harness({ container })
    await projectEvent(
      h.deps,
      imageEvent({ msgtype, body: fileName, info: { mimetype, size: 11 } }),
      ROOM,
    )
    expect(uploads[0]).toMatchObject({ fileName, declaredMimeType: mimetype })
  })

  /**
   * The degradation is deliberate. A transcript missing a picture is
   * recoverable; one missing the fact that somebody sent something is not.
   */
  it('still projects the message when the download fails', async () => {
    const { container } = uploadingContainer()
    const h = harness({ container, mediaFails: true })

    await expect(projectEvent(h.deps, imageEvent(), ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(h.executed[0].input.attachmentIds).toEqual([])
    expect(h.executed[0].input.body).toBe('holiday.png')
  })

  it('does not link a file the scan rejected', async () => {
    const { container } = uploadingContainer('infected')
    const h = harness({ container })
    await projectEvent(h.deps, imageEvent(), ROOM)
    expect(h.executed[0].input.attachmentIds).toEqual([])
  })

  /** An encrypted attachment carries `file`, not `url`, and Operis holds no keys. */
  it('leaves an encrypted attachment as a plain message', async () => {
    const { container } = uploadingContainer()
    const h = harness({ container })
    const event = parseMatrixEvent({
      type: 'm.room.message',
      event_id: '$encrypted-file',
      sender: SENDER_MXID,
      origin_server_ts: 1_772_000_000_000,
      room_id: ROOM,
      content: { msgtype: 'm.image', body: 'secret.png', file: { url: MXC } },
    })!

    await expect(projectEvent(h.deps, event, ROOM)).resolves.toEqual({
      kind: 'projected',
      messageId: PROJECTED_MESSAGE,
    })
    expect(h.downloads).toEqual([])
  })

  it('does not go near the media path for an ordinary text message', async () => {
    const { container } = uploadingContainer()
    const h = harness({ container })
    await projectEvent(h.deps, event(), ROOM)
    expect(h.downloads).toEqual([])
    expect(h.executed[0].input.attachmentIds).toEqual([])
  })
})

/**
 * A read receipt from a Matrix client. The one case that matters is an Operis
 * colleague reading the conversation in Element, whose unread should then clear
 * in Operis too.
 */
describe('projecting a read receipt', () => {
  const TARGET_EVENT = '$read-target'

  const receipt = (userMxid = SENDER_MXID, eventId = TARGET_EVENT, ts: number | null = 1_772_000_000_000) => ({
    type: 'm.receipt',
    content: { [eventId]: { 'm.read': { [userMxid]: ts === null ? {} : { ts } } } },
  })

  function withMappedMessage(h: ReturnType<typeof harness>) {
    h.em.seed(ChatMatrixEvent, {
      ...scope,
      eventId: TARGET_EVENT,
      messageId: PROJECTED_MESSAGE,
      conversationId: CONVERSATION,
      roomId: ROOM,
    })
  }

  it('advances the reader own cursor through the ordinary command', async () => {
    const h = harness()
    withMappedMessage(h)

    await expect(projectReceipts(h.deps, receipt(), ROOM)).resolves.toBe(1)
    expect(h.executed[0].id).toBe('chat.conversations.markRead')
    expect(h.executed[0].input).toMatchObject({
      conversationId: CONVERSATION,
      readAt: new Date(1_772_000_000_000).toISOString(),
      externalOrigin: { eventId: TARGET_EVENT },
    })
  })

  /** Without the marker, a receipt read in is answered with one sent back out, forever. */
  it('marks it external so it is not mirrored straight back', async () => {
    const h = harness()
    withMappedMessage(h)
    await projectReceipts(h.deps, receipt(), ROOM)
    expect((h.executed[0].input.externalOrigin as Record<string, unknown>).eventId).toBe(TARGET_EVENT)
  })

  it('acts as the person who read, not as whoever is running the loop', async () => {
    const h = harness()
    withMappedMessage(h)
    await projectReceipts(h.deps, receipt(), ROOM)
    expect((h.executed[0].ctx as { auth?: { sub?: string } }).auth?.sub).toBe(SENDER)
  })

  it('falls back to the database clock when the receipt carries no timestamp', async () => {
    // `markRead` clamps to `now()` anyway, so an absent `ts` means "as of now"
    // rather than "at the epoch".
    const h = harness()
    withMappedMessage(h)
    await projectReceipts(h.deps, receipt(SENDER_MXID, TARGET_EVENT, null), ROOM)
    expect(h.executed[0].input.readAt).toBeUndefined()
  })

  it('ignores a receipt from somebody who is not an Operis identity', async () => {
    const h = harness()
    withMappedMessage(h)
    await expect(
      projectReceipts(h.deps, receipt('@om_bot:operis.local'), ROOM),
    ).resolves.toBe(0)
    expect(h.executed).toHaveLength(0)
  })

  it('ignores a receipt pointing at a message it never mirrored', async () => {
    const h = harness()
    await expect(projectReceipts(h.deps, receipt(SENDER_MXID, '$unknown'), ROOM)).resolves.toBe(0)
    expect(h.executed).toHaveLength(0)
  })

  it('ignores a room Operis never created', async () => {
    const h = harness({ withRoom: false })
    await expect(projectReceipts(h.deps, receipt(), ROOM)).resolves.toBe(0)
  })

  /**
   * `m.read.private` exists so a client can advance its own marker without
   * telling the room. Honouring it here would leak exactly what it is for.
   */
  it('reads only the public receipt', async () => {
    const h = harness()
    withMappedMessage(h)
    const privateOnly = {
      type: 'm.receipt',
      content: { [TARGET_EVENT]: { 'm.read.private': { [SENDER_MXID]: { ts: 1 } } } },
    }
    await expect(projectReceipts(h.deps, privateOnly, ROOM)).resolves.toBe(0)
    expect(h.executed).toHaveLength(0)
  })

  it('is not confused by a timeline event', async () => {
    const h = harness()
    await expect(projectReceipts(h.deps, event(), ROOM)).resolves.toBe(0)
  })
})

