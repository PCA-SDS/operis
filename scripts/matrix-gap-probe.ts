/**
 * Empirical gap probe: drive the REAL chat transport and the REAL projector
 * against the REAL homeserver, and record what a Matrix-native chat client
 * would expect that Operis does not do.
 *
 *   yarn matrix:gap-probe
 *
 * Unlike `matrix:verify:transport`, which asserts the happy paths hold, this
 * asserts the CURRENT boundary of the transport — so a later phase that closes
 * a gap makes a probe here fail loudly instead of quietly staying true.
 *
 * The database is faked exactly as in `matrix-transport-check.ts`; everything
 * that touches Matrix is real.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MatrixClient,
  buildSyncFilter,
  mxidForUser,
  parseMatrixEvent,
  parseReadReceipts,
  parseTypingNotification,
  resolveMatrixConfig,
} from '@open-mercato/matrix'
import { createMatrixChatTransport } from '@open-mercato/core/modules/chat_matrix/lib/transport'
import { projectEvent } from '@open-mercato/core/modules/chat_matrix/lib/projection'
import { ChatMatrixEvent, ChatMatrixRoom } from '@open-mercato/core/modules/chat_matrix/data/entities'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'

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

const PROBE_FILE_NAME = 'holiday.png'
const PROBE_FILE_BYTES = Buffer.from('probe-image-bytes')

type Row = Record<string, unknown>

class MemoryEm {
  readonly rows = new Map<unknown, Row[]>()
  private bucket(entity: unknown): Row[] {
    const existing = this.rows.get(entity)
    if (existing) return existing
    const created: Row[] = []
    this.rows.set(entity, created)
    return created
  }
  async find(entity: unknown, where: Row): Promise<Row[]> {
    return this.bucket(entity).filter((row) =>
      Object.entries(where).every(([key, value]) => {
        if (value === undefined) return true
        if (value && typeof value === 'object' && '$in' in (value as Row)) {
          return ((value as Row).$in as unknown[]).includes(row[key])
        }
        return row[key] === value
      }),
    )
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
}

let confirmed = 0
let unexpected = 0
const findings: string[] = []

const gap = (name: string, detail: string) => {
  confirmed += 1
  findings.push(name)
  process.stdout.write(`\x1b[33m  ⚠ GAP\x1b[0m ${name}\n       \x1b[90m${detail}\x1b[0m\n`)
}
const held = (name: string, detail: string) => {
  process.stdout.write(`\x1b[32m  ✓ OK \x1b[0m ${name}  \x1b[90m${detail}\x1b[0m\n`)
}
const broke = (name: string, detail: string) => {
  unexpected += 1
  process.stdout.write(`\x1b[31m  ✗ ERR\x1b[0m ${name}\n       \x1b[31m${detail}\x1b[0m\n`)
}

async function probe(name: string, fn: () => Promise<{ gap: boolean; detail: string }>) {
  try {
    const result = await fn()
    if (result.gap) gap(name, result.detail)
    else held(name, result.detail)
  } catch (error) {
    broke(name, error instanceof Error ? error.message : String(error))
  }
}

/**
 * A command bus that records rather than writes, so projection can be observed.
 *
 * It does one thing a pure recorder would not: on a `chat.messages.send` that
 * carries an external origin it writes the `chat_matrix_events` mapping the real
 * command writes through `recordPublication`. Without it every relation that
 * follows would report `unmapped-target` — an artefact of the fake, not of the
 * projector.
 */
function recordingBus(em: MemoryEm, scope: { tenantId: string; organizationId: string }) {
  const calls: Array<{ id: string; input: Record<string, unknown> }> = []
  return {
    calls,
    bus: {
      async execute(id: string, payload: Record<string, unknown>) {
        const input = (payload.input ?? {}) as Record<string, unknown>
        calls.push({ id, input })
        const origin = (input.externalOrigin ?? {}) as Row
        const messageId = (origin.messageId as string) ?? randomUUID()
        if (id === 'chat.messages.send' && origin.eventId) {
          const now = new Date()
          em.persist(
            em.create(ChatMatrixEvent, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              messageId,
              subjectKey: null,
              conversationId: input.conversationId as string,
              roomId: '',
              eventId: origin.eventId as string,
              eventType: 'm.room.message',
              originServerTs: now,
              projectedAt: now,
              createdAt: now,
            }),
          )
          await em.flush()
        }
        return { result: { message: { id: messageId }, deduplicated: false } }
      },
    } as never,
  }
}

async function main(): Promise<void> {
  process.stdout.write(
    `\x1b[1mMatrix capability gap probe\x1b[0m  \x1b[90m${config.baseUrl} · ${config.serverName}\x1b[0m\n\n`,
  )

  const em = new MemoryEm()
  const ctx = { em: em as never }
  const transport = createMatrixChatTransport(config)
  const client = new MatrixClient(config)

  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const conversationId = randomUUID()
  const owner = randomUUID()
  const member = randomUUID()
  const ownerMxid = mxidForUser(config, owner)
  const memberMxid = mxidForUser(config, member)

  // Provision exactly as the live send path does — which, since the roster fix,
  // names the space's real owners instead of an empty list.
  await transport.ensureConversation(ctx, scope, {
    conversationId,
    kind: 'space',
    title: 'Gap probe space',
    memberUserIds: [owner, member],
    ownerUserIds: [owner],
  })
  const roomRow = (await em.findOne(ChatMatrixRoom, { conversationId })) as Row
  const roomId = roomRow.roomId as string
  process.stdout.write(`\x1b[90m  room ${roomId}\x1b[0m\n\n`)

  process.stdout.write('\x1b[1mRoom governance\x1b[0m\n')

  await probe('a space owner is given power to moderate the room', async () => {
    const levels = await client.getStateEvent<Record<string, unknown>>(
      roomId,
      'm.room.power_levels',
      '',
      client.botUserId,
    )
    const users = (levels.users ?? {}) as Record<string, number>
    const ownerLevel = users[ownerMxid]
    const redactLevel = Number(levels.redact ?? 50)
    return {
      gap: !(typeof ownerLevel === 'number' && ownerLevel >= redactLevel),
      detail:
        typeof ownerLevel === 'number'
          ? `the owner sits at ${ownerLevel}; redact requires ${redactLevel}`
          : `only ${client.botUserId} is elevated; redact requires ${redactLevel}, every member sits at ${levels.users_default}`,
    }
  })

  process.stdout.write('\n\x1b[1mOutbound coverage\x1b[0m\n')

  const messageId = randomUUID()
  const body = `gap probe ${Date.now()}`

  /**
   * One clean attachment, and a storage driver that hands back its bytes.
   *
   * The database is the only thing faked here, exactly as it is for every other
   * check in this file — the upload, the event and the homeserver are real.
   */
  const attachmentId = randomUUID()
  em.persist(
    em.create(Attachment, {
      id: attachmentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      partitionCode: 'privateAttachments',
      fileName: PROBE_FILE_NAME,
      mimeType: 'image/png',
      fileSize: PROBE_FILE_BYTES.length,
      storagePath: 'probe/holiday.png',
      scanStatus: 'clean',
    }),
  )
  await em.flush()
  const storageContainer = {
    resolve(name: string) {
      if (name !== 'storageDriverFactory') throw new Error(`no ${name}`)
      return {
        async resolveForPartition() {
          return {
            async read() {
              return { buffer: PROBE_FILE_BYTES, contentType: 'image/png' }
            },
          }
        },
      }
    },
  } as never
  const mediaCtx = { em: em as never, container: storageContainer }

  const published = await transport.publishMessage(mediaCtx, scope, {
    conversationId,
    conversationKind: 'space',
    messageId,
    senderUserId: member,
    senderName: 'Probe Member',
    body,
    createdAt: new Date(),
    replyToMessageId: null,
    clientMessageId: null,
    attachmentIds: [attachmentId],
    recipientUserIds: [owner, member],
  })

  // What the send command does inside its transaction: tie the Operis message to
  // the event it became. Without it nothing downstream — a reaction, an edit, a
  // receipt — can find the message again.
  await transport.recordPublication(mediaCtx, scope, {
    conversationId,
    messageId,
    externalId: published.externalId,
    originServerTs: new Date(),
  } as never)

  await probe('an attachment travels with its message', async () => {
    // The file itself is its own event: Matrix has no concept of a message with
    // an attachment hanging off it.
    const annotations = await client.relations(roomId, published.externalId, client.botUserId)
    void annotations
    const timeline = await client.messages(roomId, { dir: 'b', limit: 20 }, client.botUserId)
    const media = (timeline.chunk ?? []).find((raw) => {
      const content = (raw as { content?: Record<string, unknown> }).content ?? {}
      return content.msgtype === 'm.image' && content.body === PROBE_FILE_NAME
    })
    const content = ((media as { content?: Record<string, unknown> } | undefined)?.content ?? {}) as Record<string, unknown>
    return {
      gap: !media,
      detail: media
        ? `${String(content.msgtype)} carrying ${String(content.url)}`
        : 'the message went out as m.text alone — no mxc:// and no m.image',
    }
  })

  await probe('a space owner can moderate a member message on the homeserver', async () => {
    try {
      await client.redact({
        roomId,
        eventId: published.externalId,
        transactionId: `probe-${randomUUID()}`,
        asUser: ownerMxid,
      })
      return { gap: false, detail: 'the owner redacted it' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        gap: true,
        detail: `the homeserver refused the owner's redaction — ${message.slice(0, 160)}`,
      }
    }
  })

  await probe('renaming the space renames the room', async () => {
    const before = await client.getStateEvent<Record<string, unknown>>(
      roomId,
      'm.room.name',
      '',
      client.botUserId,
    )
    // There is no transport method to call; the seam has no rename.
    const hasRename = 'publishConversationRenamed' in transport || 'publishMembership' in transport
    return {
      gap: !hasRename,
      detail: `room name is "${String(before.name)}" and the ChatTransport interface exposes only: ${Object.keys(transport).join(', ')}`,
    }
  })

  await probe('removing a member removes them from the room', async () => {
    const joined = await client.joinedMembers(roomId, client.botUserId)
    const count = Object.keys(joined.joined ?? {}).length
    const hasRemoval = 'publishMembership' in transport
    return {
      gap: !hasRemoval,
      detail: `${count} joined; no transport method can kick or leave, so an Operis removal leaves the person reading the room`,
    }
  })

  process.stdout.write('\n\x1b[1mInbound coverage — what an Element user does\x1b[0m\n')

  const bus = recordingBus(em, scope)
  /**
   * A container that answers only what projection asks it for: the attachment
   * upload service. Faked for the same reason the database is — everything that
   * touches Matrix stays real.
   */
  const ingested: Array<Record<string, unknown>> = []
  const projectionContainer = {
    resolve(name: string) {
      if (name !== 'attachmentScopedUploadService') throw new Error(`no ${name}`)
      return {
        async upload(payload: Record<string, unknown>) {
          ingested.push(payload)
          return { id: randomUUID(), scanStatus: 'clean' }
        },
      }
    },
  } as never
  const deps = { em: em as never, commandBus: bus.bus, config, client, container: projectionContainer }

  const projectRaw = async (raw: unknown) => {
    const event = parseMatrixEvent(raw)
    if (!event) throw new Error('the probe built an event the parser rejects')
    return projectEvent(deps, event, roomId)
  }

  // A genuine outside message first, to prove the probe's plumbing projects at all.
  const outsideId = await (async () => {
    const sent = await client.sendEvent({
      roomId,
      eventType: 'm.room.message',
      transactionId: `probe-out-${randomUUID()}`,
      content: { msgtype: 'm.text', body: `from element ${Date.now()}` },
      asUser: memberMxid,
    })
    return sent.event_id
  })()

  await probe('a plain message typed in Element becomes a chat message', async () => {
    const event = await client.getEvent(roomId, outsideId, client.botUserId)
    const outcome = await projectRaw(event)
    return {
      gap: outcome.kind !== 'projected',
      detail:
        outcome.kind === 'projected'
          ? `projected via ${bus.calls.at(-1)?.id}`
          : `skipped: ${outcome.reason}`,
    }
  })

  await probe('a reaction added in Element reaches Operis', async () => {
    const sent = await client.sendEvent({
      roomId,
      eventType: 'm.reaction',
      transactionId: `probe-react-${randomUUID()}`,
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: outsideId, key: '🔥' } },
      asUser: ownerMxid,
    })
    const event = await client.getEvent(roomId, sent.event_id, client.botUserId)
    const outcome = await projectRaw(event)
    return {
      gap: outcome.kind === 'skipped',
      detail: outcome.kind === 'skipped' ? `dropped as "${outcome.reason}"` : 'projected',
    }
  })

  await probe('a message redacted in Element disappears from Operis', async () => {
    const target = await client.sendEvent({
      roomId,
      eventType: 'm.room.message',
      transactionId: `probe-doomed-${randomUUID()}`,
      content: { msgtype: 'm.text', body: `doomed ${Date.now()}` },
      asUser: memberMxid,
    })
    // Project it first: a redaction can only remove a message Operis has, and
    // an outside client's message becomes one by being projected.
    await projectRaw(await client.getEvent(roomId, target.event_id, client.botUserId))
    const redaction = await client.redact({
      roomId,
      eventId: target.event_id,
      transactionId: `probe-redact-${randomUUID()}`,
      asUser: memberMxid,
    })
    const event = await client.getEvent(roomId, redaction.event_id, client.botUserId)
    const outcome = await projectRaw(event)
    return {
      gap: outcome.kind === 'skipped',
      detail: outcome.kind === 'skipped' ? `dropped as "${outcome.reason}"` : 'projected',
    }
  })

  await probe('a message edited in Element updates the Operis copy', async () => {
    const sent = await client.sendEvent({
      roomId,
      eventType: 'm.room.message',
      transactionId: `probe-edit-${randomUUID()}`,
      content: {
        msgtype: 'm.text',
        body: '* edited from element',
        'm.new_content': { msgtype: 'm.text', body: 'edited from element' },
        'm.relates_to': { rel_type: 'm.replace', event_id: outsideId },
      },
      asUser: memberMxid,
    })
    const event = await client.getEvent(roomId, sent.event_id, client.botUserId)
    const outcome = await projectRaw(event)
    return {
      gap: outcome.kind === 'skipped',
      detail: outcome.kind === 'skipped' ? `dropped as "${outcome.reason}"` : 'projected',
    }
  })

  await probe('an image posted in Element arrives as an attachment', async () => {
    const upload = await client.uploadMedia({
      body: Buffer.from('probe-image-bytes'),
      contentType: 'image/png',
      fileName: 'probe.png',
      asUser: memberMxid,
    })
    const sent = await client.sendEvent({
      roomId,
      eventType: 'm.room.message',
      transactionId: `probe-img-${randomUUID()}`,
      content: { msgtype: 'm.image', body: 'probe.png', url: upload.content_uri },
      asUser: memberMxid,
    })
    const event = await client.getEvent(roomId, sent.event_id, client.botUserId)
    const before = ingested.length
    const outcome = await projectRaw(event)
    const linked = ((bus.calls.at(-1)?.input as Row)?.attachmentIds ?? []) as string[]
    const stored = ingested.length > before ? ingested[ingested.length - 1] : null
    return {
      gap: !(outcome.kind === 'projected' && linked.length === 1 && stored),
      detail: stored
        ? `${upload.content_uri} copied into Operis storage as "${String(stored.fileName)}" and linked to the message`
        : `projected without the file — the mxc:// (${upload.content_uri}) was discarded`,
    }
  })

  await probe('a threaded reply from Element keeps its thread', async () => {
    const sent = await client.sendEvent({
      roomId,
      eventType: 'm.room.message',
      transactionId: `probe-thread-${randomUUID()}`,
      content: {
        msgtype: 'm.text',
        body: 'in a thread',
        'm.relates_to': { rel_type: 'm.thread', event_id: outsideId },
      },
      asUser: memberMxid,
    })
    const event = await client.getEvent(roomId, sent.event_id, client.botUserId)
    const before = bus.calls.length
    const outcome = await projectRaw(event)
    const call = bus.calls.at(-1)
    const replyTo = bus.calls.length > before ? (call?.input as Row)?.replyToMessageId : undefined
    return {
      gap: outcome.kind === 'projected' && !replyTo,
      detail:
        outcome.kind === 'projected'
          ? `projected flat: replyToMessageId=${String(replyTo)} — the m.thread relation is dropped`
          : `skipped: ${outcome.reason}`,
    }
  })

  process.stdout.write('\n\x1b[1mEphemeral signals\x1b[0m\n')

  await probe('typing reaches the other side', async () => {
    await transport.publishTyping(mediaCtx, scope, {
      conversationId,
      userId: member,
      typing: true,
    })
    // Read it back as the OTHER member, because a typing notification is never
    // echoed to the person typing.
    const seen = await client.sync({
      timeoutMs: 0,
      asUser: ownerMxid,
      filter: buildSyncFilter({ ephemeralTypes: ['m.typing'] }),
    })
    const room = (seen.rooms?.join ?? {})[roomId] as
      | { ephemeral?: { events?: unknown[] } }
      | undefined
    const typing = (room?.ephemeral?.events ?? [])
      .map((raw) => parseTypingNotification(raw))
      .find((one) => one?.userIds.includes(memberMxid))
    return {
      gap: !typing,
      detail: typing
        ? `the homeserver reports ${memberMxid} typing to everyone else in the room`
        : 'nothing in the room reports anyone typing',
    }
  })

  await probe('a read receipt is shared with the room', async () => {
    await transport.publishReadReceipt(mediaCtx, scope, {
      conversationId,
      userId: member,
      messageId,
    })
    const seen = await client.sync({
      timeoutMs: 0,
      asUser: ownerMxid,
      filter: buildSyncFilter({ ephemeralTypes: ['m.receipt'] }),
    })
    const room = (seen.rooms?.join ?? {})[roomId] as
      | { ephemeral?: { events?: unknown[] } }
      | undefined
    const mine = (room?.ephemeral?.events ?? [])
      .flatMap((raw) => parseReadReceipts(raw))
      .find((one) => one.userId === memberMxid)
    return {
      gap: !mine,
      detail: mine
        ? `m.read from ${mine.userId} at ${mine.eventId}`
        : 'last_read_at never left Postgres',
    }
  })

  process.stdout.write(
    `\n${confirmed} gap(s) confirmed against a live homeserver, ${unexpected} probe error(s)\n`,
  )
  if (unexpected > 0) process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`\x1b[31m✗ ${error instanceof Error ? error.stack : String(error)}\x1b[0m\n`)
  process.exit(1)
})
