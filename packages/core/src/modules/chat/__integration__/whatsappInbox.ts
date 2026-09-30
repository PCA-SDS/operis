import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import type { WhatsAppStub } from './whatsappStub'

/**
 * What the WhatsApp inbox specs share: the homeserver as the bridge would drive
 * it, the appservice push, and the chat API as a colleague sees it.
 *
 * A chat arrives the way the bridge delivers one: a portal room on the real
 * homeserver with the account's identity and a WhatsApp ghost in it, and the
 * events pushed to the appservice endpoint with the `hs_token`. Ghosts live in
 * the bridge's exclusive namespace, so only its token (OM_TEST_WHATSAPP_AS_TOKEN)
 * can make one.
 */

export const PASSWORD = 'Valid1!Pass'
export const HOMESERVER = process.env.OM_MATRIX_HOMESERVER_URL
const AS_TOKEN = process.env.OM_MATRIX_AS_TOKEN
const HS_TOKEN = process.env.OM_MATRIX_HS_TOKEN
const SERVER_NAME = process.env.OM_MATRIX_SERVER_NAME
const USER_PREFIX = process.env.OM_MATRIX_USER_PREFIX ?? 'om_'
export const WHATSAPP_AS_TOKEN = process.env.OM_TEST_WHATSAPP_AS_TOKEN
/** The double-puppet token: the one way to act as an account identity, as the bridge does. */
export const DOUBLE_PUPPET_TOKEN = process.env.OM_MATRIX_DOUBLE_PUPPET_AS_TOKEN
const BOT_LOCALPART = process.env.OM_MATRIX_BOT_LOCALPART ?? 'om_bot'
export const PROVISIONING_URL = process.env.OM_MATRIX_WHATSAPP_PROVISIONING_URL
export const PROVISIONING_SECRET = process.env.OM_MATRIX_WHATSAPP_PROVISIONING_SECRET
const TRANSPORT = (process.env.OM_CHAT_TRANSPORT ?? 'local').toLowerCase()
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

export const inboxConfigured =
  TRANSPORT === 'matrix' &&
  Boolean(HOMESERVER && AS_TOKEN && HS_TOKEN && SERVER_NAME && WHATSAPP_AS_TOKEN && PROVISIONING_SECRET) &&
  /^http:\/\/127\.0\.0\.1:\d+$/.test(PROVISIONING_URL ?? '')

export const INBOX_SKIP_REASON =
  'requires the Matrix transport, the homeserver tokens, OM_TEST_WHATSAPP_AS_TOKEN and a local provisioning URL for the stub'

export const uniqueStamp = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
export const accountMxid = (accountId: string) => `@${USER_PREFIX}a_${accountId.replace(/-/g, '')}:${SERVER_NAME}`
export const personalMxid = (accountId: string) => `@opp_${accountId.replace(/-/g, '')}:${SERVER_NAME}`
export const botMxid = () => `@${BOT_LOCALPART}:${SERVER_NAME}`

export type MatrixEvent = { type: string; event_id: string; sender: string; content: Record<string, unknown> }

export async function matrix<T>(
  route: string,
  options: { params?: Record<string, string>; init?: RequestInit; token?: string } = {},
): Promise<T> {
  const url = new URL(`${HOMESERVER}${route}`)
  for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value)
  const response = await fetch(url, {
    ...options.init,
    headers: {
      authorization: `Bearer ${options.token ?? AS_TOKEN}`,
      'content-type': 'application/json',
      ...(options.init?.headers ?? {}),
    },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`matrix ${route} → ${response.status} ${body.slice(0, 200)}`)
  return (body ? JSON.parse(body) : {}) as T
}

/**
 * A WhatsApp contact, made the way the bridge makes one: in its namespace, with
 * its token. Given a phone number, the ghost is named after it, as the bridge
 * names everyone whose number WhatsApp shows.
 */
export async function whatsappGhost(
  label: string,
  options: { phone?: string } = {},
): Promise<{ userId: string; displayName: string }> {
  const localpart = options.phone
    ? `whatsapp_${options.phone.replace(/\D/g, '')}`
    : `whatsapp_qa${label}${uniqueStamp()}`.toLowerCase()
  const userId = `@${localpart}:${SERVER_NAME}`
  await matrix('/_matrix/client/v3/register', {
    token: WHATSAPP_AS_TOKEN,
    init: { method: 'POST', body: JSON.stringify({ type: 'm.login.application_service', username: localpart }) },
  })
  const displayName = `QA Customer ${label} ${uniqueStamp().slice(-5)}`
  await matrix(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, {
    token: WHATSAPP_AS_TOKEN,
    params: { user_id: userId },
    init: { method: 'PUT', body: JSON.stringify({ displayname: displayName }) },
  })
  return { userId, displayName }
}

/** A portal: the ghost's room, with the account's identity joined, as the bridge leaves it. */
export async function portal(ghost: string, account: string): Promise<string> {
  const created = await matrix<{ room_id: string }>('/_matrix/client/v3/createRoom', {
    token: WHATSAPP_AS_TOKEN,
    params: { user_id: ghost },
    init: { method: 'POST', body: JSON.stringify({ preset: 'private_chat', is_direct: true, invite: [account] }) },
  })
  await matrix(`/_matrix/client/v3/join/${encodeURIComponent(created.room_id)}`, {
    params: { user_id: account },
    init: { method: 'POST', body: '{}' },
  })
  return created.room_id
}

export async function timeline(roomId: string, asUser: string, token?: string): Promise<MatrixEvent[]> {
  const page = await matrix<{ chunk?: MatrixEvent[] }>(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
    params: { user_id: asUser, dir: 'b', limit: '50' },
    token,
  })
  return page.chunk ?? []
}

/**
 * A chat on a personal number, as the bridge leaves it: the contact's room with
 * the employee's own identity joined — through the double-puppet token, the
 * only one that may act as it. No Operis identity is in it.
 */
export async function personalPortal(ghost: string, identity: string, options: { name?: string } = {}): Promise<string> {
  const created = await matrix<{ room_id: string }>('/_matrix/client/v3/createRoom', {
    token: WHATSAPP_AS_TOKEN,
    params: { user_id: ghost },
    init: {
      method: 'POST',
      body: JSON.stringify({ preset: 'private_chat', invite: [identity], ...(options.name ? { name: options.name } : {}) }),
    },
  })
  await matrix(`/_matrix/client/v3/join/${encodeURIComponent(created.room_id)}`, {
    token: DOUBLE_PUPPET_TOKEN,
    params: { user_id: identity },
    init: { method: 'POST', body: '{}' },
  })
  return created.room_id
}

/** Something a contact says on WhatsApp, as the bridge relays it into the room. */
export async function ghostSays(roomId: string, ghost: string, body: string): Promise<MatrixEvent> {
  const txn = `qa-${uniqueStamp()}`
  const sent = await matrix<{ event_id: string }>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`,
    {
      token: WHATSAPP_AS_TOKEN,
      params: { user_id: ghost },
      init: { method: 'PUT', body: JSON.stringify({ msgtype: 'm.text', body }) },
    },
  )
  return {
    type: 'm.room.message',
    event_id: sent.event_id,
    sender: ghost,
    content: { msgtype: 'm.text', body },
  }
}

let counter = 0
export function roomEvent(
  roomId: string,
  sender: string,
  type: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  counter += 1
  return {
    type,
    event_id: `$qa-wa-${uniqueStamp()}-${counter}`,
    sender,
    origin_server_ts: Date.now(),
    room_id: roomId,
    content,
    ...extra,
  }
}

export async function push(request: APIRequestContext, events: Array<Record<string, unknown>>): Promise<void> {
  const response = await request.fetch(`${BASE_URL}/api/chat_matrix/appservice/_matrix/app/v1/transactions/qa-wa-${uniqueStamp()}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${HS_TOKEN}` },
    data: { events, ephemeral: [] },
  })
  expect(response.status(), await response.text()).toBe(200)
}

export type Person = { id: string; email: string; token: string; name: string }
export type Conversation = {
  id: string
  kind: string
  unreadCount: number
  viewerAccess?: 'viewer' | 'participant' | 'manager' | null
  external: {
    network: string
    contacts: Array<{ id: string; name: string }>
    account: { id: string; name: string; connected: boolean } | null
  } | null
}
export type Message = {
  id: string
  body: string
  senderUserId: string | null
  senderExternalContactId: string | null
  senderAccountId: string | null
  senderName: string
  visibility?: 'shared' | 'internal'
}

export async function person(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  name: string,
): Promise<Person> {
  const email = `wa-inbox-${name.toLowerCase().replace(/\s+/g, '-')}-${uniqueStamp()}@qa.test`
  const id = await createUserFixture(request, adminToken, { email, password: PASSWORD, organizationId, roles: [roleId], name })
  return { id, email, name, token: await getAuthToken(request, email, PASSWORD) }
}

export async function conversations(request: APIRequestContext, token: string): Promise<Conversation[]> {
  const response = await apiRequest(request, 'GET', '/api/chat/conversations?limit=100', { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).items as Conversation[]
}

export async function conversationOf(request: APIRequestContext, token: string, conversationId: string): Promise<Conversation> {
  const response = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}`, { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()) as Conversation
}

export async function transcript(request: APIRequestContext, token: string, conversationId: string): Promise<Message[]> {
  const response = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/messages`, { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).items as Message[]
}

export async function notificationsOf(request: APIRequestContext, token: string, type: string, sourceEntityId: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/notifications?pageSize=100', { token })
  const items = ((await response.json()).items ?? []) as Array<{ type?: string; sourceEntityId?: string }>
  return items.filter((item) => item.type === type && item.sourceEntityId === sourceEntityId).length
}

/** A company account for these colleagues, connected through the stub. */
export async function connectedAccount(
  request: APIRequestContext,
  adminToken: string,
  stub: WhatsAppStub,
  memberUserIds: string[],
): Promise<{ id: string; name: string; identity: string }> {
  const created = await apiRequest(request, 'POST', '/api/chat/accounts', {
    token: adminToken,
    data: { network: 'whatsapp', name: `QA Inbox ${uniqueStamp()}`, ownerType: 'company', memberUserIds },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const account = (await created.json()).account as { id: string; name: string }
  const connect = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/connect`, {
    token: adminToken,
    data: { flow: 'qr' },
  })
  expect(connect.ok(), await connect.text()).toBeTruthy()
  await expect.poll(() => stub.complete(accountMxid(account.id)), { timeout: 20_000 }).toBe(true)
  await expect
    .poll(async () => {
      const read = await apiRequest(request, 'GET', `/api/chat/accounts/${account.id}`, { token: adminToken })
      return ((await read.json()).account as { status: string }).status
    }, { timeout: 20_000 })
    .toBe('connected')
  return { id: account.id, name: account.name, identity: accountMxid(account.id) }
}

/** A customer writes to the account; the chat is adopted and `token`'s holder sees it. */
export async function incomingChat(
  request: APIRequestContext,
  token: string,
  account: { id: string; identity: string },
  label: string,
  options: { phone?: string } = {},
): Promise<{ conversation: Conversation; roomId: string; ghost: { userId: string; displayName: string } }> {
  const ghost = await whatsappGhost(label, options)
  const roomId = await portal(ghost.userId, account.identity)
  await push(request, [
    roomEvent(roomId, account.identity, 'm.room.member', { membership: 'join' }, { state_key: account.identity }),
    roomEvent(roomId, ghost.userId, 'm.room.message', { msgtype: 'm.text', body: `hello from ${label} ${uniqueStamp()}` }),
  ])
  let conversation: Conversation | undefined
  await expect
    .poll(async () => {
      conversation = (await conversations(request, token)).find((item) => item.external?.account?.id === account.id)
      return Boolean(conversation)
    }, { message: 'the chat should be adopted for the team', timeout: 30_000 })
    .toBe(true)
  return { conversation: conversation!, roomId, ghost }
}

/** Whether anything in the portal carries this text — what the customer's phone could ever show. */
export async function portalCarries(roomId: string, asUser: string, text: string): Promise<boolean> {
  return (await timeline(roomId, asUser)).some((event) => JSON.stringify(event.content ?? {}).includes(text))
}

/** A phone number nobody else in this run has: `+49151` and eight random digits. */
export function uniquePhone(): string {
  return `+49151${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
}
