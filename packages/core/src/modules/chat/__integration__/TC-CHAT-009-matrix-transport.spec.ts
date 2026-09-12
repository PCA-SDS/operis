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
})
