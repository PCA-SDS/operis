import { spawn } from 'node:child_process'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix'] }

const PASSWORD = 'Valid1!Pass'

/**
 * TC-CHAT-009: the chat module, running on a real Matrix homeserver.
 *
 * Every other chat spec asserts what Operis returns. This one asserts what
 * ended up on the **homeserver** — because with the Matrix transport the API
 * answering correctly is only half the claim. A message that Operis stored and
 * failed to publish looks identical from the outside, and would be found only
 * when somebody else read the room.
 *
 * Nothing here touches the database directly. The room is located by reading
 * the appservice's own `/sync` and matching on a body this run generated, which
 * is exactly how an outside observer would find it.
 *
 * Skipped unless the deployment actually runs the transport, so the suite stays
 * green on a default `local` install.
 */

const HOMESERVER = process.env.OM_MATRIX_HOMESERVER_URL
const AS_TOKEN = process.env.OM_MATRIX_AS_TOKEN
const SERVER_NAME = process.env.OM_MATRIX_SERVER_NAME
const USER_PREFIX = process.env.OM_MATRIX_USER_PREFIX ?? 'om_'
const BOT_LOCALPART = process.env.OM_MATRIX_BOT_LOCALPART ?? 'om_bot'
const TRANSPORT = (process.env.OM_CHAT_TRANSPORT ?? 'local').toLowerCase()

const configured = TRANSPORT === 'matrix' && Boolean(HOMESERVER && AS_TOKEN && SERVER_NAME)

/** The identity scheme the transport mints: `@<prefix>u_<uuid without dashes>`. */
const mxidFor = (userId: string) =>
  `@${USER_PREFIX}u_${userId.replace(/-/g, '').toLowerCase()}:${SERVER_NAME}`

const botMxid = () => `@${BOT_LOCALPART}:${SERVER_NAME}`

type MatrixEvent = {
  type: string
  event_id: string
  sender: string
  content: Record<string, unknown>
}

async function matrix<T>(
  path: string,
  params: Record<string, string> = {},
  init: RequestInit = {},
): Promise<T> {
  const url = new URL(`${HOMESERVER}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${AS_TOKEN}`, ...(init.headers ?? {}) },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`matrix ${path} → ${response.status} ${body.slice(0, 200)}`)
  return (body ? JSON.parse(body) : {}) as T
}

type SyncResponse = {
  next_batch: string
  rooms?: { join?: Record<string, { timeline?: { events?: MatrixEvent[] } }> }
}

/**
 * Find the room carrying a body this run wrote, polling until it appears.
 *
 * `/sync` is eventually consistent with `/send`, and an identical repeated
 * initial sync is served from Synapse's response cache — so the cursor is
 * advanced on every pass and results accumulate, exactly as the real reader does.
 */
async function findRoomCarrying(
  needle: string,
  timeoutMs = 20_000,
): Promise<{ roomId: string; events: MatrixEvent[] }> {
  const deadline = Date.now() + timeoutMs
  const byRoom = new Map<string, MatrixEvent[]>()
  let cursor: string | undefined

  for (;;) {
    const synced = await matrix<SyncResponse>('/_matrix/client/v3/sync', {
      timeout: '0',
      user_id: botMxid(),
      ...(cursor ? { since: cursor } : {}),
    })
    cursor = synced.next_batch

    for (const [roomId, room] of Object.entries(synced.rooms?.join ?? {})) {
      const existing = byRoom.get(roomId) ?? []
      existing.push(...(room?.timeline?.events ?? []))
      byRoom.set(roomId, existing)
    }

    for (const [roomId, events] of byRoom) {
      if (events.some((event) => event.content?.body === needle)) return { roomId, events }
    }

    if (Date.now() > deadline) throw new Error(`no Matrix room carried "${needle}" within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function relationsOf(roomId: string, eventId: string, relType: string): Promise<MatrixEvent[]> {
  const page = await matrix<{ chunk?: MatrixEvent[] }>(
    `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(eventId)}/${relType}`,
    { user_id: botMxid() },
  )
  return page.chunk ?? []
}

type Person = { id: string; email: string; token: string }

async function createColleague(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Person> {
  const email = `mx-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA Matrix ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}


/** Post an event into a room as one of our own namespaced users. */
async function matrixSend(
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
  asUser: string,
): Promise<string> {
  const sent = await matrix<{ event_id: string }>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${eventType}/${encodeURIComponent(
      `qa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    )}`,
    { user_id: asUser },
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(content) },
  )
  return sent.event_id
}

async function matrixRedact(roomId: string, eventId: string, asUser: string): Promise<string> {
  const sent = await matrix<{ event_id: string }>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(
      eventId,
    )}/${encodeURIComponent(`qa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)}`,
    { user_id: asUser },
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' },
  )
  return sent.event_id
}

/**
 * Drain the inbound reader the way an operator would.
 *
 * The scheduled `/sync` job is registered at system scope every 5 seconds, and
 * the QA harness runs with `AUTO_SPAWN_SCHEDULER=false` — so nothing enqueues
 * it. `yarn mercato chat_matrix sync` invokes the same worker function directly,
 * which is exactly what the CLI exists for.
 */
async function drainMatrixSync(): Promise<void> {
  const appRoot = process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('yarn', ['mercato', 'chat_matrix', 'sync'], {
      cwd: path.resolve(appRoot, '..', '..'),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`chat_matrix sync exited ${code}: ${stderr.slice(0, 400)}`))
    })
  })
}

type TranscriptMessage = {
  id: string
  body: string
  editedAt?: string | null
  reactions?: Array<{ emoji: string; count: number }>
}

async function transcript(
  request: APIRequestContext,
  token: string,
  conversationId: string,
): Promise<TranscriptMessage[]> {
  const response = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/messages`, {
    token,
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).items as TranscriptMessage[]
}

test.describe('TC-CHAT-009: chat on a Matrix homeserver', () => {
  test.skip(
    !configured,
    'requires OM_CHAT_TRANSPORT=matrix and a configured homeserver',
  )

  test('a conversation, its messages, replies and reactions all reach the homeserver', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    expect(organizationId, 'the admin token should carry an organization').toBeTruthy()

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Matrix ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId!, roleId, 'alice')
      bob = await createColleague(request, adminToken, organizationId!, roleId, 'bob')

      // --- everything below goes through the ordinary Operis API ---

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect(opened.ok()).toBeTruthy()
      const conversationId = (await opened.json()).id as string

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const firstBody = `matrix transport check ${stamp}`

      const sent = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token, data: { body: firstBody } },
      )
      expect(sent.ok()).toBeTruthy()
      const messageId = (await sent.json()).message.id as string

      const replyBody = `and a reply ${stamp}`
      const replied = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: bob.token, data: { body: replyBody, replyToMessageId: messageId } },
      )
      expect(replied.ok()).toBeTruthy()

      // --- and now: did any of it actually reach the homeserver? ---

      const { roomId, events } = await findRoomCarrying(firstBody)

      const firstEvent = events.find((event) => event.content?.body === firstBody)
      expect(firstEvent, 'the message should exist on the homeserver').toBeTruthy()
      expect(
        firstEvent!.sender,
        'it should be sent as the author, not as the appservice bot',
      ).toBe(mxidFor(alice.id))

      const replyEvent = events.find((event) => event.content?.body === replyBody)
      expect(replyEvent, 'the reply should exist on the homeserver').toBeTruthy()
      expect(replyEvent!.sender).toBe(mxidFor(bob.id))
      expect(
        (replyEvent!.content['m.relates_to'] as Record<string, unknown> | undefined)?.[
          'm.in_reply_to'
        ],
        'the reply should be threaded to its parent',
      ).toEqual({ event_id: firstEvent!.event_id })

      // --- reactions ---

      const reacted = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages/${messageId}/reactions`,
        { token: bob.token, data: { emoji: '🎯' } },
      )
      expect(reacted.ok()).toBeTruthy()
      expect((await reacted.json()).reacted).toBe(true)

      await expect
        .poll(
          async () => {
            const annotations = await relationsOf(roomId, firstEvent!.event_id, 'm.annotation')
            return annotations.filter(
              (event) =>
                (event.content['m.relates_to'] as Record<string, unknown>)?.key === '🎯' &&
                Object.keys(event.content).length > 0,
            ).length
          },
          { message: 'the reaction should become an annotation on the homeserver', timeout: 15_000 },
        )
        .toBe(1)

      const unreacted = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages/${messageId}/reactions`,
        { token: bob.token, data: { emoji: '🎯' } },
      )
      expect(unreacted.ok()).toBeTruthy()
      expect((await unreacted.json()).reacted).toBe(false)

      await expect
        .poll(
          async () => {
            const annotations = await relationsOf(roomId, firstEvent!.event_id, 'm.annotation')
            // A redacted annotation keeps its place and loses its content.
            return annotations.filter((event) => Object.keys(event.content).length > 0).length
          },
          { message: 'taking the reaction back should redact the annotation', timeout: 15_000 },
        )
        .toBe(0)

      // --- and the API still answers exactly as it did before any of this ---

      const transcript = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token },
      )
      expect(transcript.ok()).toBeTruthy()
      const bodies = ((await transcript.json()).items as Array<{ body: string }>).map(
        (item) => item.body,
      )
      expect(bodies).toContain(firstBody)
      expect(bodies).toContain(replyBody)
    } finally {
      if (alice) await deleteUserIfExists(request, adminToken, alice.id)
      if (bob) await deleteUserIfExists(request, adminToken, bob.id)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a send fails loudly when the homeserver rejects it, rather than storing a message nobody else has', async ({
    request,
  }) => {
    test.skip(
      (process.env.OM_CHAT_MATRIX_MODE ?? 'shadow').toLowerCase() !== 'authoritative',
      'only authoritative mode couples a send to the homeserver',
    )

    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA MxFail ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId!, roleId, 'afail')
      bob = await createColleague(request, adminToken, organizationId!, roleId, 'bfail')

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect(opened.ok()).toBeTruthy()
      const conversationId = (await opened.json()).id as string

      // A body at the edge of what Operis accepts still has to survive the round
      // trip: the whole point of the transport is that nothing the API allowed
      // before becomes unsendable now.
      const long = 'x'.repeat(4000)
      const sent = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token, data: { body: long } },
      )
      expect(sent.ok(), 'a maximum-length body should still send').toBeTruthy()
      expect((await sent.json()).message.body).toHaveLength(4000)
    } finally {
      if (alice) await deleteUserIfExists(request, adminToken, alice.id)
      if (bob) await deleteUserIfExists(request, adminToken, bob.id)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  /**
   * The inbound direction, driven the way a colleague using Element would drive
   * it: the event is posted straight at the homeserver, the reader is drained,
   * and every assertion is made over the ordinary authorized HTTP route. Nothing
   * here touches the database.
   */
  test('a reaction, an edit and a redaction made outside Operis land in the transcript', async ({
    request,
  }) => {
    // Four CLI-driven `/sync` drains, each its own process against a real
    // homeserver. The suite default of 20s is a budget for one HTTP round trip.
    test.setTimeout(180_000)

    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA MxIn ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId!, roleId, 'ain')
      bob = await createColleague(request, adminToken, organizationId!, roleId, 'bin')

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect(opened.ok()).toBeTruthy()
      const conversationId = (await opened.json()).id as string

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const anchorBody = `inbound anchor ${stamp}`
      const sent = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token, data: { body: anchorBody } },
      )
      expect(sent.ok()).toBeTruthy()
      const anchorMessageId = (await sent.json()).message.id as string

      const { roomId, events } = await findRoomCarrying(anchorBody)
      const anchorEvent = events.find((event) => event.content?.body === anchorBody)!
      expect(anchorEvent, 'the anchor should be on the homeserver').toBeTruthy()

      // --- Bob reacts in Element ---
      await matrixSend(
        roomId,
        'm.reaction',
        { 'm.relates_to': { rel_type: 'm.annotation', event_id: anchorEvent.event_id, key: '🚀' } },
        mxidFor(bob.id),
      )
      await drainMatrixSync()

      const afterReaction = await transcript(request, alice.token, conversationId)
      const reacted = afterReaction.find((message) => message.id === anchorMessageId)
      expect(
        reacted?.reactions?.some((entry) => entry.emoji === '🚀' && entry.count === 1),
        'a reaction added in Element should reach Operis',
      ).toBeTruthy()

      // --- Alice rewrites her own message in Element ---
      const correctedBody = `inbound corrected ${stamp}`
      await matrixSend(
        roomId,
        'm.room.message',
        {
          msgtype: 'm.text',
          body: `* ${correctedBody}`,
          'm.new_content': { msgtype: 'm.text', body: correctedBody },
          'm.relates_to': { rel_type: 'm.replace', event_id: anchorEvent.event_id },
        },
        mxidFor(alice.id),
      )
      await drainMatrixSync()

      const afterEdit = await transcript(request, alice.token, conversationId)
      const edited = afterEdit.find((message) => message.id === anchorMessageId)
      expect(edited?.body, 'the new content, never the asterisk fallback').toBe(correctedBody)
      expect(edited?.editedAt, 'an inbound edit should be marked as one').toBeTruthy()

      // --- and Bob posts something, then Alice deletes hers ---
      const bobBody = `from element ${stamp}`
      await matrixSend(roomId, 'm.room.message', { msgtype: 'm.text', body: bobBody }, mxidFor(bob.id))
      await drainMatrixSync()
      expect(
        (await transcript(request, alice.token, conversationId)).some((m) => m.body === bobBody),
        'a plain message from Element should project',
      ).toBeTruthy()

      await matrixRedact(roomId, anchorEvent.event_id, mxidFor(alice.id))
      await drainMatrixSync()

      const afterRedaction = await transcript(request, alice.token, conversationId)
      expect(
        afterRedaction.some((message) => message.id === anchorMessageId),
        'a message redacted in Element should leave the transcript',
      ).toBeFalsy()
      expect(
        afterRedaction.some((message) => message.body === bobBody),
        "and only that message — the rest of the room is untouched",
      ).toBeTruthy()
    } finally {
      if (alice) await deleteUserIfExists(request, adminToken, alice.id)
      if (bob) await deleteUserIfExists(request, adminToken, bob.id)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  /**
   * Files, both directions.
   *
   * Matrix models a file as a message of its own, so a chat message carrying a
   * picture is two events in the room — and a picture posted in Element is a
   * chat message whose attachment Operis stores itself rather than linking from
   * Synapse, because a bridged file served straight from the homeserver would
   * bypass `scan_status`.
   */
  test('a file sent in Operis reaches the media repo, and one posted outside comes back', async ({
    request,
  }) => {
    test.setTimeout(180_000)

    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA MxFile ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId!, roleId, 'afile')
      bob = await createColleague(request, adminToken, organizationId!, roleId, 'bfile')

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect(opened.ok()).toBeTruthy()
      const conversationId = (await opened.json()).id as string

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const outboundName = `operis-${stamp}.txt`

      // --- Alice attaches a file the ordinary way ---
      const staged = await request.fetch(
        `${process.env.BASE_URL ?? 'http://localhost:3000'}/api/chat/conversations/${conversationId}/attachments`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${alice.token}` },
          multipart: {
            file: { name: outboundName, mimeType: 'text/plain', buffer: Buffer.from(`sent ${stamp}`) },
          },
        },
      )
      expect(staged.ok(), await staged.text()).toBeTruthy()
      const attachmentId = (await staged.json()).item.id as string

      const withFile = `here is the file ${stamp}`
      const sent = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token, data: { body: withFile, attachmentIds: [attachmentId] } },
      )
      expect(sent.ok(), await sent.text()).toBeTruthy()
      expect((await sent.json()).message.attachments).toHaveLength(1)

      const { roomId, events } = await findRoomCarrying(withFile)

      // The file is its own event, alongside the text.
      const fileEvent = events.find((event) => event.content?.body === outboundName)
      expect(fileEvent, 'the attachment should be its own event on the homeserver').toBeTruthy()
      expect(fileEvent!.sender).toBe(mxidFor(alice.id))
      expect(
        String(fileEvent!.content.url ?? ''),
        'it should carry an mxc:// from the media repo, not an Operis URL',
      ).toMatch(/^mxc:\/\//)
      expect(fileEvent!.content.msgtype).toBe('m.file')

      // --- and Bob posts an image straight into the room ---
      const inboundName = `element-${stamp}.png`
      const uploaded = await matrix<{ content_uri: string }>(
        '/_matrix/media/v3/upload',
        { user_id: mxidFor(bob.id), filename: inboundName },
        {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: Buffer.from(`inbound ${stamp}`),
        },
      )
      await matrixSend(
        roomId,
        'm.room.message',
        {
          msgtype: 'm.image',
          body: inboundName,
          url: uploaded.content_uri,
          info: { mimetype: 'image/png', size: 20 },
        },
        mxidFor(bob.id),
      )
      await drainMatrixSync()

      const after = await transcript(request, alice.token, conversationId)
      const projected = after.find((message) => message.body === inboundName) as
        | (TranscriptMessage & { attachments?: Array<{ fileName: string; mimeType: string }> })
        | undefined
      expect(projected, 'the image should project into the transcript').toBeTruthy()
      expect(
        projected?.attachments?.[0]?.fileName,
        'and arrive as a real attachment, not just a filename in the body',
      ).toBe(inboundName)
      expect(projected?.attachments?.[0]?.mimeType).toBe('image/png')
    } finally {
      if (alice) await deleteUserIfExists(request, adminToken, alice.id)
      if (bob) await deleteUserIfExists(request, adminToken, bob.id)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  /**
   * Push mode: the homeserver PUTs a transaction at Operis instead of leaving
   * it to be found on the next poll.
   *
   * Driven exactly as Synapse drives it — same URL shape, same `hs_token`, same
   * body — because the endpoint is unauthenticated and that token is the entire
   * security boundary. Both halves are asserted: the transaction is applied, and
   * one without the token is refused.
   */
  test('a transaction pushed by the homeserver is applied, and an unauthenticated one is not', async ({
    request,
  }) => {
    test.setTimeout(120_000)
    const hsToken = process.env.OM_MATRIX_HS_TOKEN
    test.skip(!hsToken, 'requires the appservice hs_token')

    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const base = process.env.BASE_URL ?? 'http://localhost:3000'

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    const pushTransaction = (txnId: string, events: unknown[], token: string | null) =>
      request.fetch(`${base}/api/chat_matrix/appservice/_matrix/app/v1/transactions/${txnId}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        data: { events },
      })

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA MxPush ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId!, roleId, 'apush')
      bob = await createColleague(request, adminToken, organizationId!, roleId, 'bpush')

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect(opened.ok()).toBeTruthy()
      const conversationId = (await opened.json()).id as string

      // A first message so the room exists and is mapped — a pushed event for a
      // room Operis never created is correctly ignored.
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const anchorBody = `push anchor ${stamp}`
      const sent = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token, data: { body: anchorBody } },
      )
      expect(sent.ok()).toBeTruthy()
      const { roomId } = await findRoomCarrying(anchorBody)

      // --- an unauthenticated push is refused before anything is read ---
      const unauthenticated = await pushTransaction(`qa-noauth-${stamp}`, [], null)
      expect(unauthenticated.status(), 'no token must not be accepted').toBe(403)
      expect(await unauthenticated.json()).toEqual({ errcode: 'M_FORBIDDEN' })

      const wrongToken = await pushTransaction(`qa-badauth-${stamp}`, [], 'not-the-hs-token')
      expect(wrongToken.status(), 'a wrong token must not be accepted').toBe(403)

      // --- and a real one is applied ---
      const pushedBody = `pushed by the homeserver ${stamp}`
      const txnId = `qa-txn-${stamp}`
      const accepted = await pushTransaction(
        txnId,
        [
          {
            type: 'm.room.message',
            event_id: `$qa-pushed-${stamp}`,
            sender: mxidFor(bob.id),
            origin_server_ts: Date.now(),
            room_id: roomId,
            content: { msgtype: 'm.text', body: pushedBody },
          },
        ],
        hsToken!,
      )
      expect(accepted.status(), await accepted.text()).toBe(200)

      await expect
        .poll(
          async () => (await transcript(request, alice!.token, conversationId)).map((m) => m.body),
          { message: 'the pushed message should reach the transcript', timeout: 30_000 },
        )
        .toContain(pushedBody)

      /**
       * Synapse retries a transaction it did not see acknowledged, so the same
       * id arriving again must acknowledge without applying anything twice.
       */
      const retried = await pushTransaction(
        txnId,
        [
          {
            type: 'm.room.message',
            event_id: `$qa-pushed-${stamp}`,
            sender: mxidFor(bob.id),
            origin_server_ts: Date.now(),
            room_id: roomId,
            content: { msgtype: 'm.text', body: pushedBody },
          },
        ],
        hsToken!,
      )
      expect(retried.status(), 'a retried transaction is a success, not a conflict').toBe(200)

      const bodies = (await transcript(request, alice.token, conversationId)).map((m) => m.body)
      expect(bodies.filter((body) => body === pushedBody), 'and applies it once').toHaveLength(1)
    } finally {
      if (alice) await deleteUserIfExists(request, adminToken, alice.id)
      if (bob) await deleteUserIfExists(request, adminToken, bob.id)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
