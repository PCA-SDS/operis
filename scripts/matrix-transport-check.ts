/**
 * Phase 2 acceptance: drive the REAL chat transport against the REAL homeserver.
 *
 *   yarn matrix:verify:transport
 *
 * The unit tests prove the transport makes the right decisions against fakes,
 * and `matrix:verify` proves the homeserver accepts the operations. Neither
 * proves the composition, which is what this does: the actual
 * `createMatrixChatTransport`, the actual `MatrixClient`, the actual Synapse.
 *
 * The database is the one thing faked — an in-memory stand-in for the four
 * mapping tables — so this runs without a provisioned tenant. Everything that
 * touches Matrix is real.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveMatrixConfig } from '@open-mercato/matrix'
import { createMatrixChatTransport } from '@open-mercato/core/modules/chat_matrix/lib/transport'
import { projectEvent } from '@open-mercato/core/modules/chat_matrix/lib/projection'
import { MatrixClient, buildSyncFilter, parseMatrixEvent, mxidForUser } from '@open-mercato/matrix'
import {
  ChatMatrixEvent,
  ChatMatrixIdentity,
  ChatMatrixRoom,
} from '@open-mercato/core/modules/chat_matrix/data/entities'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENV_FILE = path.join(ROOT, '.matrix-dev', 'matrix.env')

if (!fs.existsSync(ENV_FILE)) {
  process.stderr.write('\x1b[31m✗ .matrix-dev/matrix.env not found — run `yarn matrix:up` first\x1b[0m\n')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)

const config = resolveMatrixConfig({
  homeserverUrl: env.OM_MATRIX_HOMESERVER_URL,
  serverName: env.OM_MATRIX_SERVER_NAME,
  asToken: env.OM_MATRIX_AS_TOKEN,
  senderLocalpart: env.OM_MATRIX_SENDER_LOCALPART,
  userPrefix: env.OM_MATRIX_USER_PREFIX,
  botLocalpart: env.OM_MATRIX_BOT_LOCALPART,
})

type Row = Record<string, unknown>

/** The four mapping tables, in memory. Everything else here is real. */
class MemoryEm {
  readonly rows = new Map<unknown, Row[]>()

  private bucket(entity: unknown): Row[] {
    const existing = this.rows.get(entity)
    if (existing) return existing
    const created: Row[] = []
    this.rows.set(entity, created)
    return created
  }

  async findOne(entity: unknown, where: Row): Promise<Row | null> {
    return (
      this.bucket(entity).find((row) =>
        Object.entries(where).every(([key, value]) => value === undefined || row[key] === value),
      ) ?? null
    )
  }

  create(entity: unknown, data: Row): Row {
    return { ...data, __entity: entity }
  }

  private pending: Row[] = []
  persist(row: Row): void {
    this.pending.push(row)
  }
  remove(row: Row): void {
    for (const rows of this.rows.values()) {
      const index = rows.indexOf(row)
      if (index >= 0) rows.splice(index, 1)
    }
  }
  async flush(): Promise<void> {
    for (const row of this.pending) this.bucket(row.__entity).push(row)
    this.pending = []
  }
  fork(): MemoryEm {
    return this
  }
  count(entity: unknown): number {
    return this.bucket(entity).length
  }
}

let passed = 0
let failed = 0

const pass = (name: string, detail = '') =>
  (passed += 1,
  process.stdout.write(`\x1b[32m  ✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}\n`))
const fail = (name: string, detail: string) =>
  (failed += 1,
  process.stdout.write(`\x1b[31m  ✗ ${name}\x1b[0m\n     \x1b[31m${detail}\x1b[0m\n`))

async function check<T>(name: string, fn: () => Promise<T>, detail?: (value: T) => string) {
  try {
    const value = await fn()
    pass(name, detail?.(value))
    return value
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error))
    return null
  }
}

async function main(): Promise<void> {
  process.stdout.write(
    `\x1b[1mChat transport → Matrix, end to end\x1b[0m  \x1b[90m${config.baseUrl} · ${config.serverName}\x1b[0m\n\n`,
  )

  const em = new MemoryEm()
  const ctx = { em: em as never }
  const transport = createMatrixChatTransport(config)
  const client = new MatrixClient(config)

  /**
   * Where the stream stands before this run does anything.
   *
   * Taken once, up front, because an INITIAL `/sync` (no cursor) is cached by
   * Synapse for identical parameters — repeating one in a poll loop re-reads the
   * same stale snapshot forever. The real loop never does that: it syncs once
   * and then advances a cursor, which is what everything below follows.
   */
  const syncBaseline = (await client.sync({ timeoutMs: 0, filter: buildSyncFilter() })).next_batch

  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const conversationId = randomUUID()
  const alice = randomUUID()
  const bob = randomUUID()
  const messageId = randomUUID()

  const publishInput = {
    conversationId,
    conversationKind: 'space' as const,
    messageId,
    senderUserId: alice,
    senderName: 'Alice (transport check)',
    body: 'Sent through the real chat transport.',
    createdAt: new Date(),
    replyToMessageId: null,
    clientMessageId: null,
    attachmentIds: [],
    recipientUserIds: [alice, bob],
  }

  process.stdout.write('\x1b[1mProvisioning\x1b[0m\n')

  await check(
    'transport reports its id',
    async () => transport.id,
    (id) => String(id),
  )

  await check('ensureConversation creates a room and both identities', async () => {
    await transport.ensureConversation(ctx, scope, {
      conversationId,
      kind: 'space',
      title: 'Transport check',
      memberUserIds: [alice, bob],
      ownerUserIds: [alice],
    })
    if (em.count(ChatMatrixRoom) !== 1) throw new Error('no room row was written')
    if (em.count(ChatMatrixIdentity) !== 2) throw new Error('expected two identity rows')
    const room = await em.findOne(ChatMatrixRoom, { conversationId })
    if (room?.state !== 'ready') throw new Error(`room state is ${room?.state}`)
    return room?.roomId as string
  }, (roomId) => String(roomId))

  await check('ensureConversation is idempotent', async () => {
    await transport.ensureConversation(ctx, scope, {
      conversationId,
      kind: 'space',
      title: 'Transport check',
      memberUserIds: [alice, bob],
      ownerUserIds: [alice],
    })
    if (em.count(ChatMatrixRoom) !== 1) throw new Error('a second room row appeared')
    return true
  }, () => 'still one room')

  process.stdout.write('\n\x1b[1mPublishing\x1b[0m\n')

  /**
   * Publish and record, exactly as `chat.messages.send` does.
   *
   * The two are separate calls on the transport because they happen at
   * different moments once Matrix is authoritative — the publish before the
   * message row exists, the record inside the transaction that creates it.
   * Skipping the record here is what a broken caller would do, and it would
   * leave the echo suppressor with nothing to recognise.
   */
  const publishAndRecord = async (input: typeof publishInput) => {
    const result = await transport.publishMessage(ctx, scope, input)
    if (!result.externalId) return result
    // Record only when this is the first time we are storing the message.
    // The command reaches `recordPublication` only inside the transaction that
    // CREATES the row, so a resend that dedupes never records twice; mirroring
    // that here keeps the check honest about what the real caller does.
    const already = await em.findOne(ChatMatrixEvent, { messageId: input.messageId })
    if (!already) {
      await transport.recordPublication(ctx, scope, {
        conversationId: input.conversationId,
        messageId: input.messageId,
        externalId: result.externalId,
        createdAt: input.createdAt,
      })
    }
    return result
  }

  const first = await check(
    'publishMessage reaches the homeserver',
    async () => {
      const result = await publishAndRecord(publishInput)
      if (!result.externalId?.startsWith('$')) throw new Error(`unexpected event id: ${result.externalId}`)
      return result.externalId
    },
    (eventId) => String(eventId),
  )

  await check(
    'republishing the same message returns the same event',
    async () => {
      // The transaction id is derived from the Operis message id, so the
      // homeserver returns the original event rather than posting a duplicate.
      // This is the property the shadow writer's safety rests on.
      const again = await publishAndRecord(publishInput)
      if (again.externalId !== first) {
        throw new Error(`duplicate posted: ${again.externalId} !== ${first}`)
      }
      return again.externalId
    },
    () => 'no duplicate — a retried publish is safe',
  )

  await check('a threaded reply carries m.in_reply_to', async () => {
    const replyId = randomUUID()
    const result = await publishAndRecord({
      ...publishInput,
      messageId: replyId,
      senderUserId: bob,
      senderName: 'Bob (transport check)',
      body: 'And a reply.',
      replyToMessageId: messageId,
    })
    if (!result.externalId) throw new Error('reply was not published')
    return result.externalId
  })

  await check('every publish is recorded for the drift check', async () => {
    // Two distinct messages; the republish must not add a third row.
    const count = em.count(ChatMatrixEvent)
    if (count !== 2) throw new Error(`expected 2 event mappings, found ${count}`)
    return count
  }, (count) => `${count} mappings`)

  process.stdout.write('\n\x1b[1mReactions\x1b[0m\n')

  const reactionRoom = (await em.findOne(ChatMatrixRoom, { conversationId })) as { roomId: string }
  const reactionClient = new MatrixClient(config)
  const reaction = { conversationId, messageId, userId: bob, emoji: '\u{1F44D}' }

  const annotationId = await check(
    'a reaction becomes an m.annotation on the message',
    async () => {
      await transport.publishReaction(ctx, scope, { ...reaction, added: true })
      const relations = await reactionClient.relations(
        reactionRoom.roomId,
        first!,
        mxidForUser(config, bob),
        'm.annotation',
      )
      const found = relations.chunk.find(
        (event) => event.content?.['m.relates_to']?.['key'] === '\u{1F44D}',
      )
      if (!found) throw new Error('the annotation was not attached to the message')
      return found.event_id
    },
    (id) => String(id),
  )

  await check(
    'reacting twice does not annotate twice',
    async () => {
      await transport.publishReaction(ctx, scope, { ...reaction, added: true })
      const relations = await reactionClient.relations(
        reactionRoom.roomId,
        first!,
        mxidForUser(config, bob),
        'm.annotation',
      )
      if (relations.chunk.length !== 1) {
        throw new Error(`expected 1 annotation, found ${relations.chunk.length}`)
      }
      return relations.chunk.length
    },
    () => 'still one',
  )

  await check(
    'taking the reaction back redacts the annotation',
    async () => {
      await transport.publishReaction(ctx, scope, { ...reaction, added: false })
      const event = await reactionClient.getEvent(
        reactionRoom.roomId,
        annotationId!,
        mxidForUser(config, bob),
      )
      if (event && Object.keys(event.content ?? {}).length !== 0) {
        throw new Error('the annotation still carries content')
      }
      return true
    },
    () => 'content gone',
  )

  await check(
    'reacting again after a redaction mirrors afresh',
    async () => {
      // The mapping row went with the redaction, so this is a new annotation
      // rather than a no-op against a dead event.
      await transport.publishReaction(ctx, scope, { ...reaction, added: true })
      const relations = await reactionClient.relations(
        reactionRoom.roomId,
        first!,
        mxidForUser(config, bob),
        'm.annotation',
      )
      const live = relations.chunk.filter(
        (event) => Object.keys(event.content ?? {}).length > 0,
      )
      if (live.length !== 1) throw new Error(`expected 1 live annotation, found ${live.length}`)
      return live[0].event_id
    },
    (id) => String(id),
  )

  process.stdout.write('\n\x1b[1mEdits and deletions\x1b[0m\n')

  const editRoom = (await em.findOne(ChatMatrixRoom, { conversationId })) as { roomId: string }
  const editClient = new MatrixClient(config)
  const firstEditAt = new Date('2026-09-10T12:30:00.000Z')

  const firstEditId = await check(
    'an edit becomes an m.replace on the original event',
    async () => {
      await transport.publishEdit(ctx, scope, {
        conversationId,
        messageId,
        senderUserId: alice,
        senderName: 'Alice (transport check)',
        body: 'Hello from the transport check, corrected.',
        editedAt: firstEditAt,
      })
      const relations = await editClient.relations(
        editRoom.roomId,
        first!,
        mxidForUser(config, alice),
        'm.replace',
      )
      const replacement = relations.chunk.find(
        (event) =>
          (event.content?.['m.new_content'] as { body?: string } | undefined)?.body ===
          'Hello from the transport check, corrected.',
      )
      if (!replacement) throw new Error('no m.replace carrying the new content')
      return replacement.event_id
    },
    (id) => String(id),
  )

  await check(
    'a retry of the same edit posts no second replacement',
    async () => {
      // The transaction id is derived from the message AND `editedAt`, so a
      // retry after a timeout resolves to the event the first attempt made.
      await transport.publishEdit(ctx, scope, {
        conversationId,
        messageId,
        senderUserId: alice,
        senderName: 'Alice (transport check)',
        body: 'Hello from the transport check, corrected.',
        editedAt: firstEditAt,
      })
      const relations = await editClient.relations(
        editRoom.roomId,
        first!,
        mxidForUser(config, alice),
        'm.replace',
      )
      if (relations.chunk.length !== 1) {
        throw new Error(`expected 1 replacement, found ${relations.chunk.length}`)
      }
      return relations.chunk[0].event_id
    },
    (id) => (id === firstEditId ? 'the same event — a retry is safe' : String(id)),
  )

  await check(
    'a SECOND edit is a second replacement, not a silent no-op',
    async () => {
      /**
       * The check this whole file exists for.
       *
       * A transaction id derived from the message alone would be identical here,
       * the homeserver would hand back the FIRST edit's event, and every edit
       * after the first would silently never appear. That is exactly the bug
       * the reaction transaction id had, found the same way — against a real
       * homeserver, not a fake.
       */
      await transport.publishEdit(ctx, scope, {
        conversationId,
        messageId,
        senderUserId: alice,
        senderName: 'Alice (transport check)',
        body: 'Hello from the transport check, corrected again.',
        editedAt: new Date('2026-09-10T12:45:00.000Z'),
      })
      const relations = await editClient.relations(
        editRoom.roomId,
        first!,
        mxidForUser(config, alice),
        'm.replace',
      )
      if (relations.chunk.length !== 2) {
        throw new Error(`expected 2 replacements, found ${relations.chunk.length}`)
      }
      return relations.chunk.length
    },
    (count) => `${count} replacements`,
  )

  await check(
    'deleting redacts the original event, as the person who deleted it',
    async () => {
      await transport.publishDeletion(ctx, scope, {
        conversationId,
        messageId,
        actorUserId: alice,
        actorName: 'Alice (transport check)',
      })
      const event = await editClient.getEvent(
        editRoom.roomId,
        first!,
        mxidForUser(config, alice),
      )
      if (event && Object.keys(event.content ?? {}).length !== 0) {
        throw new Error('the message still carries content')
      }
      return true
    },
    () => 'content gone',
  )

  await check(
    'the mapping row survives the deletion',
    async () => {
      // It is what a reconciliation would use to check the redaction landed.
      const mapping = await em.findOne(ChatMatrixEvent, { messageId })
      if (!mapping) throw new Error('the mapping row was removed')
      return true
    },
    () => 'kept for reconciliation',
  )

  process.stdout.write('\n\x1b[1mInbound projection\x1b[0m\n')

  // Everything below exercises the path an event Operis did NOT send takes back
  // into a conversation: the recovery path today, and the one a bridge feeds.
  const room = (await em.findOne(ChatMatrixRoom, { conversationId })) as { roomId: string }
  const executed: Array<{ id: string; input: Record<string, unknown> }> = []
  const commandBus = {
    async execute(id: string, args: { input: Record<string, unknown> }) {
      executed.push({ id, input: args.input })
      return { result: { message: { id: randomUUID() }, deduplicated: false } }
    },
  }
  const projectionDeps = {
    em: em as never,
    commandBus: commandBus as never,
    config,
    container: {} as never,
  }

  const foreignEventId = await check(
    'a message sent outside Operis lands in the room',
    async () => {
      // Sent straight through the client, bypassing the transport entirely —
      // exactly what a bridge or a stray native client would do.
      const sent = await client.sendEvent({
        roomId: room.roomId,
        eventType: 'm.room.message',
        transactionId: `check-${randomUUID()}`,
        content: { msgtype: 'm.text', body: 'Sent without going through Operis.' },
        asUser: mxidForUser(config, bob),
      })
      return sent.event_id
    },
    (id) => String(id),
  )

  const timeline = await check(
    'the sync loop sees it',
    async () => {
      // `/sync` is eventually consistent: an event accepted by `/send` reaches
      // the sync stream a moment later. Polling briefly is what the real loop
      // does by running on a schedule; asserting on the first read would make
      // this check flaky rather than correct.
      // Advance the cursor on every pass, exactly as the worker does.
      //
      // Repeating an identical `/sync` — same `since`, same filter — is served
      // from Synapse's response cache, so a poll loop that does not move its
      // cursor re-reads one snapshot forever. Accumulate instead.
      const deadline = Date.now() + 15_000
      const seen: NonNullable<ReturnType<typeof parseMatrixEvent>>[] = []
      let cursor = syncBaseline
      for (;;) {
        const synced = await client.sync({ since: cursor, timeoutMs: 0, filter: buildSyncFilter() })
        cursor = synced.next_batch
        seen.push(
          ...(synced.rooms?.join?.[room.roomId]?.timeline?.events ?? [])
            .map(parseMatrixEvent)
            .filter((event): event is NonNullable<typeof event> => event !== null),
        )
        if (seen.some((event) => event.event_id === foreignEventId)) return seen
        if (Date.now() > deadline) throw new Error('the event never reached the sync timeline')
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    },
    (events) => `${events?.length ?? 0} timeline events`,
  )

  await check(
    'it projects into a chat message',
    async () => {
      const target = timeline!.find((event) => event.event_id === foreignEventId)!
      const outcome = await projectEvent(projectionDeps, target, room.roomId)
      if (outcome.kind !== 'projected') {
        throw new Error(`expected a projection, got skipped(${outcome.reason})`)
      }
      if (executed.length !== 1 || executed[0].id !== 'chat.messages.send') {
        throw new Error('projection did not go through the send command')
      }
      const origin = executed[0].input.externalOrigin as { eventId: string }
      if (origin.eventId !== foreignEventId) throw new Error('origin event id was not carried')
      return executed[0].input.body as string
    },
    (body) => `"${body}"`,
  )

  await check(
    'our own messages are recognised as echoes, not re-projected',
    async () => {
      // The mapping row written when we published is what makes this work, and
      // it is the difference between a working loop and one that duplicates
      // every message it reads.
      const ours = timeline!.filter((event) => event.event_id !== foreignEventId)
      if (!ours.length) throw new Error('no Operis-sent events in the timeline to test against')
      const before = executed.length
      for (const event of ours) {
        const outcome = await projectEvent(projectionDeps, event, room.roomId)
        if (outcome.kind === 'projected') {
          throw new Error(`re-projected an event we sent: ${event.event_id}`)
        }
      }
      if (executed.length !== before) throw new Error('an echo reached the send command')
      return ours.length
    },
    (count) => `${count} echoes skipped`,
  )

  await check(
    'projecting the same foreign event twice is a no-op',
    async () => {
      const target = timeline!.find((event) => event.event_id === foreignEventId)!
      // The first projection recorded a mapping via the command, which this
      // fake commandBus does not do — so simulate what the real transport writes.
      em.persist(
        em.create(ChatMatrixEvent, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          messageId: randomUUID(),
          conversationId,
          roomId: room.roomId,
          eventId: foreignEventId,
          eventType: 'm.room.message',
          originServerTs: new Date(target.origin_server_ts),
          projectedAt: new Date(),
          createdAt: new Date(),
        }),
      )
      await em.flush()

      const before = executed.length
      const outcome = await projectEvent(projectionDeps, target, room.roomId)
      if (outcome.kind !== 'skipped' || outcome.reason !== 'already-known') {
        throw new Error(`expected already-known, got ${JSON.stringify(outcome)}`)
      }
      if (executed.length !== before) throw new Error('a duplicate reached the send command')
      return true
    },
    () => 'idempotent',
  )

  process.stdout.write('\n\x1b[1mRefusals\x1b[0m\n')

  await check('refuses to publish into an unprovisioned conversation', async () => {
    try {
      // A fresh message id as well as a fresh conversation: an already-published
    // message short-circuits before the room is looked at, which is correct and
    // would make this check pass for the wrong reason.
    await publishAndRecord({
      ...publishInput,
      messageId: randomUUID(),
      conversationId: randomUUID(),
    })
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    throw new Error('expected a refusal for a conversation with no room')
  }, () => 'refused, as it should be')

  process.stdout.write('\n')
  if (failed === 0) {
    process.stdout.write(`\x1b[32m\x1b[1m✓ ${passed} checks passed\x1b[0m\n`)
    const room = await em.findOne(ChatMatrixRoom, { conversationId })
    process.stdout.write(`\x1b[90m  room ${room?.roomId}\n  inspect at http://127.0.0.1:8009\x1b[0m\n`)
    process.exit(0)
  }
  process.stdout.write(`\x1b[31m\x1b[1m✗ ${failed} of ${passed + failed} checks failed\x1b[0m\n`)
  process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`\x1b[31m✗ ${error instanceof Error ? error.stack : String(error)}\x1b[0m\n`)
  process.exit(1)
})
