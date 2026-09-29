import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix', 'chat_tasks', 'notifications'] }

const PASSWORD = 'Valid1!Pass'

/**
 * TC-CHAT-012: people outside the organization, in a room a bridge owns.
 *
 * A bridged room is linked to an external conversation with the `link-room`
 * CLI, exactly as an operator would. The outsider is a real account on the
 * homeserver — link-room checks who is actually in the room — whose localpart
 * carries the test bridge's prefix. What the outsider then says and does is
 * pushed as appservice transactions with the `hs_token`, the way Synapse
 * delivers a bridge's events. Every assertion is made over the ordinary
 * authorized HTTP API, or on the homeserver for what goes out.
 *
 * Runs only against a real homeserver with the test bridge configured:
 *
 *   OM_CHAT_TRANSPORT=matrix, the OM_MATRIX_* values from .matrix-dev/matrix.env,
 *   OM_MATRIX_BRIDGE_GHOSTS=testbridge=testbridge_ (the app and this process), and
 *   MATRIX_REGISTRATION_SHARED_SECRET from .matrix-dev/synapse/secrets.env —
 *   the one way to create an account outside the Operis namespace.
 */

const HOMESERVER = process.env.OM_MATRIX_HOMESERVER_URL
const AS_TOKEN = process.env.OM_MATRIX_AS_TOKEN
const HS_TOKEN = process.env.OM_MATRIX_HS_TOKEN
const SERVER_NAME = process.env.OM_MATRIX_SERVER_NAME
const USER_PREFIX = process.env.OM_MATRIX_USER_PREFIX ?? 'om_'
const BOT_LOCALPART = process.env.OM_MATRIX_BOT_LOCALPART ?? 'om_bot'
const TRANSPORT = (process.env.OM_CHAT_TRANSPORT ?? 'local').toLowerCase()
const REGISTRATION_SECRET = process.env.MATRIX_REGISTRATION_SHARED_SECRET
const GHOST_PREFIX = testBridgePrefix(process.env.OM_MATRIX_BRIDGE_GHOSTS)
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

const configured =
  TRANSPORT === 'matrix' &&
  Boolean(HOMESERVER && AS_TOKEN && HS_TOKEN && SERVER_NAME && REGISTRATION_SECRET && GHOST_PREFIX)

const WORD_JOINER = String.fromCharCode(0x2060)
const NUL = String.fromCharCode(0)

function testBridgePrefix(raw: string | undefined): string | null {
  for (const pair of (raw ?? '').split(',')) {
    const [network, prefix] = pair.split('=').map((part) => part.trim())
    if (network === 'testbridge' && prefix) return prefix
  }
  return null
}

const mxidFor = (userId: string) => `@${USER_PREFIX}u_${userId.replace(/-/g, '').toLowerCase()}:${SERVER_NAME}`
const botMxid = () => `@${BOT_LOCALPART}:${SERVER_NAME}`
const uniqueStamp = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`

type MatrixEvent = { type: string; event_id: string; sender: string; content: Record<string, unknown> }

/** A homeserver call, as the appservice by default or as an account with its own token. */
async function matrix<T>(
  route: string,
  options: { params?: Record<string, string>; init?: RequestInit; token?: string } = {},
): Promise<T> {
  const url = new URL(`${HOMESERVER}${route}`)
  for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value)
  const response = await fetch(url, {
    ...options.init,
    headers: { authorization: `Bearer ${options.token ?? AS_TOKEN}`, ...(options.init?.headers ?? {}) },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`matrix ${route} → ${response.status} ${body.slice(0, 200)}`)
  return (body ? JSON.parse(body) : {}) as T
}

const asBot = () => ({ user_id: botMxid() })

async function ensureBot(): Promise<void> {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { authorization: `Bearer ${AS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'm.login.application_service', username: BOT_LOCALPART }),
  })
  const body = await response.text()
  if (response.ok || body.includes('"M_USER_IN_USE"')) return
  throw new Error(`could not register the bot: ${response.status} ${body.slice(0, 200)}`)
}

type Ghost = { userId: string; token: string; displayName: string }

/**
 * An account outside the Operis namespace, named like the test bridge's ghosts.
 *
 * Synapse's shared-secret registration: the one route that creates a plain
 * account when open registration is off, which the dev homeserver keeps off.
 */
async function registerGhost(label: string): Promise<Ghost> {
  const localpart = `${GHOST_PREFIX}${label}${uniqueStamp()}`.toLowerCase()
  const displayName = `QA Customer ${label} ${uniqueStamp().slice(-6)}`
  const password = randomUUID()
  const endpoint = `${HOMESERVER}/_synapse/admin/v1/register`
  const { nonce } = (await (await fetch(endpoint)).json()) as { nonce: string }
  const mac = createHmac('sha1', REGISTRATION_SECRET!)
    .update([nonce, localpart, password, 'notadmin'].join(NUL))
    .digest('hex')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, username: localpart, displayname: displayName, password, admin: false, mac }),
  })
  const body = (await response.json()) as { user_id?: string; access_token?: string }
  if (!response.ok || !body.user_id || !body.access_token) {
    throw new Error(`could not register a test ghost: ${response.status} ${JSON.stringify(body).slice(0, 200)}`)
  }
  return { userId: body.user_id, token: body.access_token, displayName }
}

/** A room the bot owns, like a bridge portal the bot was invited into — with these accounts in it. */
async function bridgedRoom(name: string, ghosts: Ghost[]): Promise<string> {
  const created = await matrix<{ room_id: string }>('/_matrix/client/v3/createRoom', {
    params: asBot(),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'private_chat', name, invite: ghosts.map((ghost) => ghost.userId) }),
    },
  })
  for (const ghost of ghosts) await joinAs(created.room_id, ghost)
  return created.room_id
}

async function joinAs(roomId: string, ghost: Ghost): Promise<void> {
  await matrix(`/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
    token: ghost.token,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  })
}

async function roomTimeline(roomId: string): Promise<MatrixEvent[]> {
  const page = await matrix<{ chunk?: MatrixEvent[] }>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
    { params: { ...asBot(), dir: 'b', limit: '100' } },
  )
  return page.chunk ?? []
}

async function eventCarrying(roomId: string, body: string): Promise<MatrixEvent> {
  let found: MatrixEvent | undefined
  await expect
    .poll(
      async () => {
        found = (await roomTimeline(roomId)).find((event) => event.content?.body === body)
        return Boolean(found)
      },
      { message: `"${body}" should reach the homeserver`, timeout: 20_000 },
    )
    .toBe(true)
  return found!
}

type CliResult = { code: number | null; stdout: string; stderr: string }

/** The operator's CLI, run the way an operator runs it, against the same database. */
async function mercato(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  const appRoot = process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato')
  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn('yarn', ['mercato', ...args], {
      cwd: path.resolve(appRoot, '..', '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

type LinkArgs = { roomId: string; tenantId: string; organizationId: string; memberIds: string[]; title?: string }

const linkArgs = (link: LinkArgs) => [
  'chat_matrix',
  'link-room',
  '--room',
  link.roomId,
  '--tenant',
  link.tenantId,
  '--organization',
  link.organizationId,
  '--members',
  link.memberIds.join(','),
  ...(link.title ? ['--title', link.title] : []),
]

async function linkRoom(link: LinkArgs): Promise<string> {
  const result = await mercato(linkArgs(link))
  expect(result.code, `link-room failed: ${result.stderr.slice(0, 400)}`).toBe(0)
  const match = /conversation=([0-9a-f-]{36})/.exec(result.stdout)
  expect(match, `link-room printed no conversation: ${result.stdout.slice(0, 200)}`).toBeTruthy()
  return match![1]
}

async function unlinkRoom(conversationId: string): Promise<CliResult> {
  return mercato(['chat_matrix', 'unlink-room', '--conversation', conversationId])
}

/** Push events the way Synapse delivers a bridge's traffic to the appservice. */
async function push(
  request: APIRequestContext,
  events: Array<Record<string, unknown>>,
  ephemeral: Array<Record<string, unknown>> = [],
): Promise<void> {
  const response = await request.fetch(
    `${BASE_URL}/api/chat_matrix/appservice/_matrix/app/v1/transactions/qa-ext-${uniqueStamp()}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${HS_TOKEN}` },
      data: { events, ephemeral },
    },
  )
  expect(response.status(), await response.text()).toBe(200)
}

let eventCounter = 0
function roomEvent(
  roomId: string,
  sender: string,
  type: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> & { event_id: string } {
  eventCounter += 1
  return {
    type,
    event_id: `$qa-ext-${uniqueStamp()}-${eventCounter}`,
    sender,
    origin_server_ts: Date.now(),
    room_id: roomId,
    content,
    ...extra,
  }
}

const textEvent = (roomId: string, sender: string, body: string) =>
  roomEvent(roomId, sender, 'm.room.message', { msgtype: 'm.text', body })

type Person = { id: string; email: string; token: string }

async function createColleague(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Person> {
  const email = `ext-${label}-${uniqueStamp()}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA External ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

type TranscriptMessage = {
  id: string
  body: string
  senderUserId: string | null
  senderExternalContactId: string | null
  senderName: string
  senderNetwork: string | null
  editedAt: string | null
  reactions: Array<{ emoji: string; count: number }>
  attachments?: Array<{ id: string; fileName: string; mimeType: string }>
}

async function transcript(request: APIRequestContext, token: string, conversationId: string): Promise<TranscriptMessage[]> {
  const response = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/messages`, { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).items as TranscriptMessage[]
}

async function messageWithBody(
  request: APIRequestContext,
  token: string,
  conversationId: string,
  body: string,
): Promise<TranscriptMessage> {
  let found: TranscriptMessage | undefined
  await expect
    .poll(
      async () => {
        found = (await transcript(request, token, conversationId)).find((message) => message.body === body)
        return Boolean(found)
      },
      { message: `"${body}" should reach the transcript`, timeout: 30_000 },
    )
    .toBe(true)
  return found!
}

async function chatNotifications(
  request: APIRequestContext,
  token: string,
): Promise<Array<{ type: string; sourceEntityId: string | null }>> {
  const response = await apiRequest(request, 'GET', '/api/notifications?pageSize=100', { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  const items = ((await response.json()).items ?? []) as Array<{ type?: string; sourceEntityId?: string | null }>
  return items
    .filter((item) => typeof item.type === 'string' && item.type.startsWith('chat.'))
    .map((item) => ({ type: item.type as string, sourceEntityId: item.sourceEntityId ?? null }))
}

async function unreadCount(request: APIRequestContext, token: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/chat/unread-count', { token })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).unreadCount as number
}

async function send(request: APIRequestContext, token: string, conversationId: string, body: string) {
  return apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, { token, data: { body } })
}

type World = {
  adminToken: string
  tenantId: string
  organizationId: string
  roleId: string
  people: Person[]
  ghost: Ghost
  roomId: string
  conversationId: string
}

/**
 * Colleagues, an outsider in a bridged room, and that room linked to an
 * external conversation for the colleagues named. Everything it creates is
 * released by `releaseWorld`.
 */
async function linkedWorld(
  request: APIRequestContext,
  label: string,
  options: { people: string[]; linked: number; extraMemberIds?: string[]; title?: string | null },
): Promise<World> {
  const adminToken = await getAuthToken(request, 'admin')
  const { organizationId, tenantId } = getTokenContext(adminToken)
  expect(organizationId && tenantId, 'the admin token should carry a tenant and an organization').toBeTruthy()

  await ensureBot()
  const roleId = await createRoleFixture(request, adminToken, { name: `QA External ${label} ${uniqueStamp()}` })
  // No organization restriction: the isolation test seats a second organization
  // with this role, and isolation must come from chat's scoping, not the ACL.
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: ['chat.view', 'chat.send', 'tasks.view'],
    organizations: null,
  })
  const people: Person[] = []
  for (const name of options.people) people.push(await createColleague(request, adminToken, organizationId, roleId, name))

  const ghost = await registerGhost(label)
  const roomId = await bridgedRoom(`QA bridged ${label}`, [ghost])
  const conversationId = await linkRoom({
    roomId,
    tenantId,
    organizationId,
    memberIds: [...people.slice(0, options.linked).map((person) => person.id), ...(options.extraMemberIds ?? [])],
    title: options.title === undefined ? `QA Supplier ${label}` : options.title ?? undefined,
  })
  return { adminToken, tenantId, organizationId, roleId, people, ghost, roomId, conversationId }
}

async function releaseWorld(request: APIRequestContext, world: World | null): Promise<void> {
  if (!world) return
  await unlinkRoom(world.conversationId)
  for (const person of world.people) await deleteUserIfExists(request, world.adminToken, person.id)
  await deleteRoleIfExists(request, world.adminToken, world.roleId)
}

test.describe('TC-CHAT-012: external participants on a bridged room', () => {
  test.skip(
    !configured,
    'requires OM_CHAT_TRANSPORT=matrix, a homeserver, OM_MATRIX_HS_TOKEN, MATRIX_REGISTRATION_SHARED_SECRET and OM_MATRIX_BRIDGE_GHOSTS=testbridge=testbridge_',
  )

  test('an outsider reaches the linked colleagues, and nobody else', async ({ request }) => {
    test.setTimeout(240_000)
    let world: World | null = null
    try {
      world = await linkedWorld(request, 'reach', { people: ['alice', 'bob', 'dave', 'carol'], linked: 3 })
      const [alice, bob, dave, carol] = world.people
      const { conversationId, roomId, ghost } = world
      const stamp = uniqueStamp()

      // --- 1. who can see it ---
      const listed = await apiRequest(request, 'GET', '/api/chat/conversations', { token: alice.token })
      const summary = ((await listed.json()).items as Array<Record<string, unknown>>).find(
        (item) => item.id === conversationId,
      ) as { kind: string; external: { network: string; contacts: Array<{ id: string; name: string }> } } | undefined
      expect(summary, 'a linked colleague should see the conversation').toBeTruthy()
      expect(summary!.kind).toBe('external')
      expect(summary!.external.network).toBe('testbridge')
      expect(summary!.external.contacts.map((contact) => contact.name)).toEqual([ghost.displayName])
      const contactId = summary!.external.contacts[0].id

      const members = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/members`, {
        token: alice.token,
      })
      const memberList = (await members.json()) as { items: Array<{ id: string }>; externalMembers: Array<{ id: string; name: string }> }
      expect(memberList.items.map((member) => member.id).sort()).toEqual([alice.id, bob.id, dave.id].sort())
      expect(memberList.externalMembers.map((member) => member.id)).toEqual([contactId])

      for (const route of ['', '/members', '/messages']) {
        const outsider = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}${route}`, {
          token: carol.token,
        })
        expect(outsider.status(), `a colleague not linked must get 404 on ${route || 'the conversation'}`).toBe(404)
      }

      // --- 16. an outsider is never a task assignee ---
      const composer = await apiRequest(request, 'GET', `/api/chat_tasks/conversations/${conversationId}/composer`, {
        token: alice.token,
      })
      expect(composer.ok(), await composer.text()).toBeTruthy()
      const context = (await composer.json()) as { kind: string; suggestedAssignees: Array<{ id: string }> }
      expect(context.kind).toBe('external')
      expect(context.suggestedAssignees.map((assignee) => assignee.id)).not.toContain(contactId)

      // --- 5. a colleague's reply goes out, and notifies nobody ---
      const muted = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/mute`, {
        token: dave.token,
        data: { muted: true },
      })
      expect(muted.ok()).toBeTruthy()

      const reply = `we can ship on Friday ${stamp}`
      expect((await send(request, alice.token, conversationId, reply)).ok()).toBeTruthy()
      const outbound = await eventCarrying(roomId, reply)
      expect(outbound.sender, 'it should leave as its author').toBe(mxidFor(alice.id))

      const mentioning = await send(request, alice.token, conversationId, `looping in <@${bob.id}>`)
      expect(mentioning.status(), 'a mention cannot address an outsider room').toBe(400)

      const read = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/read`, {
        token: bob.token,
        data: {},
      })
      expect(read.ok()).toBeTruthy()
      // A projected message keeps the homeserver's timestamp — this process's
      // clock here — while Bob's cursor took the database's. A moment apart, so
      // a small skew between the two cannot put his cursor after the message.
      await new Promise((resolve) => setTimeout(resolve, 1_500))

      // --- 2. an outsider's message ---
      const said = `when does it arrive? ${stamp}`
      await push(request, [textEvent(roomId, ghost.userId, said)])
      const received = await messageWithBody(request, alice.token, conversationId, said)
      expect(received.senderUserId).toBeNull()
      expect(received.senderExternalContactId).toBe(contactId)
      expect(received.senderName).toBe(ghost.displayName)
      expect(received.senderNetwork).toBe('testbridge')

      // Bob had read everything before it: the outsider's message is his only
      // unread, which a NULL-unsafe predicate would never count.
      expect(await unreadCount(request, bob.token)).toBe(1)

      // --- 4. one notification per colleague, none for the muted one ---
      for (const person of [alice, bob]) {
        await expect
          .poll(async () => (await chatNotifications(request, person.token)).map((item) => item.type), {
            message: 'each linked colleague should be told once',
            timeout: 20_000,
          })
          .toEqual(['chat.external.received'])
      }
      expect((await chatNotifications(request, bob.token))[0].sourceEntityId).toBe(conversationId)
      expect(await chatNotifications(request, dave.token), 'a muted colleague is not told').toEqual([])
      expect(await chatNotifications(request, carol.token)).toEqual([])

      // --- 3. read-all clears it ---
      const readAll = await apiRequest(request, 'POST', '/api/chat/read-all', { token: bob.token, data: {} })
      expect(readAll.ok()).toBeTruthy()
      expect(await unreadCount(request, bob.token)).toBe(0)

      // --- 9. an outsider cannot mention anyone, but may type the syntax ---
      const literal = `ping <@everyone> ${stamp}`
      await push(request, [textEvent(roomId, ghost.userId, literal)])
      await expect
        .poll(
          async () =>
            (await transcript(request, alice.token, conversationId)).some(
              (message) => message.body.split(WORD_JOINER).join('') === literal,
            ),
          { message: 'the literal should be stored and shown as text', timeout: 30_000 },
        )
        .toBe(true)
      for (const person of [alice, bob]) {
        const types = (await chatNotifications(request, person.token)).map((item) => item.type)
        expect(types, 'typing the syntax mentions nobody').not.toContain('chat.mention.received')
      }
    } finally {
      await releaseWorld(request, world)
    }
  })

  test('what an outsider does after speaking lands, within their own rights', async ({ request }) => {
    test.setTimeout(240_000)
    let world: World | null = null
    try {
      world = await linkedWorld(request, 'act', { people: ['alice'], linked: 1 })
      const [alice] = world.people
      const { conversationId, roomId, ghost } = world
      const stamp = uniqueStamp()

      const colleagueBody = `the invoice is attached ${stamp}`
      expect((await send(request, alice.token, conversationId, colleagueBody)).ok()).toBeTruthy()
      const colleagueEvent = await eventCarrying(roomId, colleagueBody)

      const first = textEvent(roomId, ghost.userId, `first thought ${stamp}`)
      const second = textEvent(roomId, ghost.userId, `order number QA${stamp}`)
      await push(request, [first, second])
      const firstMessage = await messageWithBody(request, alice.token, conversationId, `first thought ${stamp}`)
      const secondMessage = await messageWithBody(request, alice.token, conversationId, `order number QA${stamp}`)

      // --- 6. try to edit a colleague's, then react and edit their own ---
      // The refused edit goes first: events apply in order, so once the later two
      // show, the refusal has already been decided.
      const corrected = `second thought ${stamp}`
      await push(request, [
        roomEvent(roomId, ghost.userId, 'm.room.message', {
          msgtype: 'm.text',
          body: '* rewritten by an outsider',
          'm.new_content': { msgtype: 'm.text', body: 'rewritten by an outsider' },
          'm.relates_to': { rel_type: 'm.replace', event_id: colleagueEvent.event_id },
        }),
        roomEvent(roomId, ghost.userId, 'm.reaction', {
          'm.relates_to': { rel_type: 'm.annotation', event_id: first.event_id, key: '👍' },
        }),
        roomEvent(roomId, ghost.userId, 'm.room.message', {
          msgtype: 'm.text',
          body: `* ${corrected}`,
          'm.new_content': { msgtype: 'm.text', body: corrected },
          'm.relates_to': { rel_type: 'm.replace', event_id: first.event_id },
        }),
      ])
      await expect
        .poll(
          async () => {
            const edited = (await transcript(request, alice.token, conversationId)).find(
              (message) => message.id === firstMessage.id,
            )
            return { body: edited?.body, reactions: edited?.reactions.map((reaction) => reaction.emoji) }
          },
          { message: 'the reaction and the edit should land', timeout: 30_000 },
        )
        .toEqual({ body: corrected, reactions: ['👍'] })
      const colleagueMessage = (await transcript(request, alice.token, conversationId)).find(
        (message) => message.senderUserId === alice.id && message.body.startsWith('the invoice'),
      )
      expect(colleagueMessage?.body, 'an outsider cannot rewrite a colleague').toBe(colleagueBody)
      expect(colleagueMessage?.editedAt).toBeNull()

      // --- 15. a colleague pins it, and search finds it under the outsider's name ---
      const pinned = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${conversationId}/messages/${secondMessage.id}/pin`,
        { token: alice.token, data: {} },
      )
      expect(pinned.ok(), await pinned.text()).toBeTruthy()
      const pins = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/pins`, {
        token: alice.token,
      })
      const pinList = (await pins.json()) as { items: Array<{ messageId: string; senderUserId: string | null; senderName: string }> }
      expect(pinList.items.map((pin) => pin.messageId)).toContain(secondMessage.id)
      const pin = pinList.items.find((item) => item.messageId === secondMessage.id)!
      expect(pin.senderUserId).toBeNull()
      expect(pin.senderName).toBe(ghost.displayName)

      const search = await apiRequest(request, 'GET', `/api/chat/search?q=${encodeURIComponent(`QA${stamp}`)}`, {
        token: alice.token,
      })
      expect(search.ok(), await search.text()).toBeTruthy()
      const hit = ((await search.json()).items as Array<{ messageId: string; senderName: string }>).find(
        (item) => item.messageId === secondMessage.id,
      )
      expect(hit?.senderName, 'search should find it under the outsider name').toBe(ghost.displayName)

      // --- 6. delete their own, and read ---
      await push(
        request,
        [roomEvent(roomId, ghost.userId, 'm.room.redaction', {}, { redacts: first.event_id })],
        [
          {
            type: 'm.receipt',
            room_id: roomId,
            content: { [colleagueEvent.event_id]: { 'm.read': { [ghost.userId]: { ts: Date.now() } } } },
          },
        ],
      )
      await expect
        .poll(
          async () => (await transcript(request, alice.token, conversationId)).some((message) => message.id === firstMessage.id),
          { message: 'their deletion should take the message out of the transcript', timeout: 30_000 },
        )
        .toBe(false)
      await expect
        .poll(
          async () => {
            const detail = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}`, {
              token: alice.token,
            })
            return Boolean((await detail.json()).counterpartLastReadAt)
          },
          { message: 'their receipt should tell colleagues it was seen', timeout: 30_000 },
        )
        .toBe(true)
    } finally {
      await releaseWorld(request, world)
    }
  })

  test("an outsider's file is stored, scanned and served by Operis", async ({ request }) => {
    test.setTimeout(240_000)
    let world: World | null = null
    try {
      world = await linkedWorld(request, 'file', { people: ['alice'], linked: 1 })
      const [alice] = world.people
      const { conversationId, roomId, ghost } = world
      const stamp = uniqueStamp()

      // --- 7 ---
      const fileName = `delivery-note-${stamp}.txt`
      const bytes = Buffer.from(`delivery note ${stamp}`)
      const uploaded = await matrix<{ content_uri: string }>('/_matrix/media/v3/upload', {
        token: ghost.token,
        params: { filename: fileName },
        init: { method: 'POST', headers: { 'content-type': 'text/plain' }, body: bytes },
      })
      await push(request, [
        roomEvent(roomId, ghost.userId, 'm.room.message', {
          msgtype: 'm.file',
          body: fileName,
          url: uploaded.content_uri,
          info: { mimetype: 'text/plain', size: bytes.length },
        }),
      ])
      const message = await messageWithBody(request, alice.token, conversationId, fileName)
      const attachment = message.attachments?.[0]
      expect(attachment?.fileName, 'it should arrive as an attachment, not only a filename').toBe(fileName)

      const served = await request.fetch(`${BASE_URL}/api/attachments/file/${attachment!.id}`, {
        headers: { authorization: `Bearer ${alice.token}` },
      })
      expect(served.ok(), 'Operis serves its own copy').toBeTruthy()
      expect((await served.body()).toString()).toBe(bytes.toString())
    } finally {
      await releaseWorld(request, world)
    }
  })

  test('only a configured ghost in an external conversation becomes an outsider', async ({ request }) => {
    test.setTimeout(240_000)
    let world: World | null = null
    try {
      world = await linkedWorld(request, 'who', { people: ['alice', 'bob'], linked: 2 })
      const [alice, bob] = world.people
      const { conversationId, roomId, ghost } = world
      const stamp = uniqueStamp()

      // --- 10. an external conversation cannot be made over HTTP ---
      const forged = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'external', title: 'forged', memberIds: [bob.id] },
      })
      expect(forged.status()).toBe(400)

      // --- 8. the bot, an unconfigured namespace, a ghost in a space ---
      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: `QA internal ${stamp}`, memberIds: [bob.id] },
      })
      expect(space.ok(), await space.text()).toBeTruthy()
      const spaceId = (await space.json()).id as string
      const spaceAnchor = `internal anchor ${stamp}`
      expect((await send(request, alice.token, spaceId, spaceAnchor)).ok()).toBeTruthy()
      const spaceRoom = await roomCarrying(spaceAnchor)

      const control = `control ${stamp}`
      await push(request, [
        textEvent(roomId, botMxid(), `from the bot ${stamp}`),
        textEvent(roomId, `@othernet_${stamp}:${SERVER_NAME}`, `from an unconfigured bridge ${stamp}`),
        textEvent(spaceRoom, ghost.userId, `a ghost in a space ${stamp}`),
        // Events apply in order: once this lands, the three before it were read.
        textEvent(roomId, mxidFor(bob.id), control),
      ])
      await messageWithBody(request, alice.token, conversationId, control)

      const external = (await transcript(request, alice.token, conversationId)).map((message) => message.body)
      expect(external).not.toContain(`from the bot ${stamp}`)
      expect(external).not.toContain(`from an unconfigured bridge ${stamp}`)
      const internal = (await transcript(request, alice.token, spaceId)).map((message) => message.body)
      expect(internal).not.toContain(`a ghost in a space ${stamp}`)

      const spaceMembers = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/members`, {
        token: alice.token,
      })
      expect((await spaceMembers.json()).externalMembers, 'nobody was seated in the space').toEqual([])
      const externalMembers = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/members`, {
        token: alice.token,
      })
      expect(
        ((await externalMembers.json()).externalMembers as Array<{ name: string }>).map((member) => member.name),
        'only the linked outsider is seated — not the bot, not the unconfigured sender',
      ).toEqual([ghost.displayName])
    } finally {
      await releaseWorld(request, world)
    }
  })

  test('link-room refuses without writing, and unlink-room closes and forgets', async ({ request }) => {
    test.setTimeout(420_000)
    let world: World | null = null
    let otherOrganization: string | null = null
    let erin: Person | null = null
    let otherConversation: string | null = null
    let relinked: string | null = null
    try {
      world = await linkedWorld(request, 'link', { people: ['alice'], linked: 1 })
      const [alice] = world.people
      const { tenantId, organizationId, roomId, ghost, conversationId } = world
      const stamp = uniqueStamp()
      const base = { tenantId, organizationId, memberIds: [alice.id] }

      // --- 13. every refusal exits non-zero; one at a time, each CLI boots the app ---
      const refusals: Array<[string, () => Promise<CliResult>, RegExp]> = [
        [
          'the transport is not matrix',
          async () => mercato(linkArgs({ ...base, roomId: await bridgedRoom('QA local', [ghost]) }), { OM_CHAT_TRANSPORT: 'local' }),
          /chat transport is "local"/,
        ],
        [
          'no bridge is configured',
          async () => mercato(linkArgs({ ...base, roomId: await bridgedRoom('QA none', [ghost]) }), { OM_MATRIX_BRIDGE_GHOSTS: '' }),
          /Refused \(no-bridges\)/,
        ],
        ['the room is already linked', () => mercato(linkArgs({ ...base, roomId })), /Refused \(already-mapped\)/],
        [
          'a member is not in the organization',
          async () =>
            mercato(linkArgs({ ...base, roomId: await bridgedRoom('QA stranger', [ghost]), memberIds: [randomUUID()] })),
          /Refused \(not-a-member\)/,
        ],
        [
          'nobody from a bridge is in the room',
          async () => mercato(linkArgs({ ...base, roomId: await bridgedRoom('QA empty', []) })),
          /Refused \(no-ghost\)/,
        ],
        [
          'the bot is not in the room',
          async () => mercato(linkArgs({ ...base, roomId: await roomWithoutBot(ghost) })),
          /Refused \(bot-not-joined\)/,
        ],
      ]
      for (const [label, run, expected] of refusals) {
        const result = await run()
        expect(result.code, `${label}: should exit non-zero`).not.toBe(0)
        expect(result.stderr, label).toMatch(expected)
      }
      const listed = await apiRequest(request, 'GET', '/api/chat/conversations', { token: alice.token })
      const externals = ((await listed.json()).items as Array<{ id: string; kind: string }>).filter(
        (item) => item.kind === 'external',
      )
      expect(externals.map((item) => item.id), 'no refusal wrote a conversation').toEqual([conversationId])

      // --- 11. the same outsider in another organization is someone else there ---
      otherOrganization = await createOrganizationFixture(request, world.adminToken, { name: `QA External Org ${stamp}` })
      erin = await createColleague(request, world.adminToken, otherOrganization, world.roleId, 'erin')
      const otherRoom = await bridgedRoom('QA bridged elsewhere', [ghost])
      otherConversation = await linkRoom({
        roomId: otherRoom,
        tenantId,
        organizationId: otherOrganization,
        memberIds: [erin.id],
      })
      await push(request, [textEvent(otherRoom, ghost.userId, `hello elsewhere ${stamp}`)])
      const elsewhere = await messageWithBody(request, erin.token, otherConversation, `hello elsewhere ${stamp}`)
      await push(request, [textEvent(roomId, ghost.userId, `hello here ${stamp}`)])
      const here = await messageWithBody(request, alice.token, conversationId, `hello here ${stamp}`)
      expect(elsewhere.senderExternalContactId).not.toBe(here.senderExternalContactId)
      expect(
        (await apiRequest(request, 'GET', `/api/chat/conversations/${otherConversation}`, { token: alice.token })).status(),
      ).toBe(404)
      expect(
        (await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}`, { token: erin.token })).status(),
      ).toBe(404)

      // --- 14. unlink ---
      const unlinked = await unlinkRoom(conversationId)
      expect(unlinked.code, unlinked.stderr).toBe(0)
      expect(
        (await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}`, { token: alice.token })).status(),
        'a closed conversation is gone for its members',
      ).toBe(404)

      const afterUnlink = `said after the unlink ${stamp}`
      const control = `control elsewhere ${stamp}`
      await push(request, [textEvent(roomId, ghost.userId, afterUnlink), textEvent(otherRoom, ghost.userId, control)])
      await messageWithBody(request, erin.token, otherConversation, control)

      const joined = await matrix<{ joined: Record<string, unknown> }>(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
        { params: asBot() },
      )
      expect(Object.keys(joined.joined), 'the room itself belongs to the bridge and stays').toContain(ghost.userId)

      relinked = await linkRoom({ ...base, roomId })
      const fresh = (await transcript(request, alice.token, relinked)).map((message) => message.body)
      expect(fresh, 'what was said while unlinked was not projected anywhere').not.toContain(afterUnlink)
    } finally {
      if (relinked) await unlinkRoom(relinked)
      if (otherConversation) await unlinkRoom(otherConversation)
      if (erin && world) await deleteUserIfExists(request, world.adminToken, erin.id)
      if (otherOrganization && world) await deleteOrganizationIfExists(request, world.adminToken, otherOrganization)
      await releaseWorld(request, world)
    }
  })

  test('the conversation page says who is outside', async ({ page, request }) => {
    test.setTimeout(240_000)
    let world: World | null = null
    try {
      const adminToken = await getAuthToken(request, 'admin')
      const adminId = getTokenScope(adminToken).userId
      // Untitled, as a one-to-one link usually is: it is then named after its
      // contact, and the warning names the person the words go to.
      world = await linkedWorld(request, 'page', { people: [], linked: 0, extraMemberIds: [adminId], title: null })

      // --- 12 ---
      await login(page, 'admin')
      await page.goto(`/backend/chat/${world.conversationId}`)
      await expect(page.getByTestId('chat-external-badge')).toBeVisible()
      await expect(page.getByTestId('chat-external-warning')).toContainText(world.ghost.displayName)
    } finally {
      await releaseWorld(request, world)
    }
  })
})

/** The room a colleague's message went to, found through the bot's own `/sync`. */
async function roomCarrying(body: string): Promise<string> {
  const deadline = Date.now() + 20_000
  let cursor: string | undefined
  for (;;) {
    const synced = await matrix<{
      next_batch: string
      rooms?: { join?: Record<string, { timeline?: { events?: MatrixEvent[] } }> }
    }>('/_matrix/client/v3/sync', { params: { ...asBot(), timeout: '0', ...(cursor ? { since: cursor } : {}) } })
    cursor = synced.next_batch
    for (const [roomId, room] of Object.entries(synced.rooms?.join ?? {})) {
      if ((room.timeline?.events ?? []).some((event) => event.content?.body === body)) return roomId
    }
    if (Date.now() > deadline) throw new Error(`no room carried "${body}"`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** A room the outsider made alone — as a bridge would before inviting the Operis bot. */
async function roomWithoutBot(ghost: Ghost): Promise<string> {
  const created = await matrix<{ room_id: string }>('/_matrix/client/v3/createRoom', {
    token: ghost.token,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'private_chat', name: 'QA no bot' }),
    },
  })
  return created.room_id
}
