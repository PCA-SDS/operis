#!/usr/bin/env node
/**
 * Phase 0 acceptance: prove the local homeserver can carry everything the chat
 * module needs, using only the appservice credential.
 *
 *   yarn matrix:verify
 *
 * This is not a smoke test. Each check corresponds to a capability the chat
 * transport depends on, and the interesting ones are the negative checks:
 * namespace enforcement, transaction-id idempotency, and the /sync refusal for
 * the appservice's own sender. Those are the three things that, discovered late,
 * cost days.
 *
 * It leaves the room it creates in place so the same state can be inspected in
 * the Element console at http://127.0.0.1:8009.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, '.matrix-dev', 'matrix.env')

if (!fs.existsSync(ENV_FILE)) {
  process.stderr.write('\x1b[31m✗ .matrix-dev/matrix.env not found — run `yarn matrix:up` first\x1b[0m\n')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)

const HS = env.OM_MATRIX_HOMESERVER_URL
const SERVER = env.OM_MATRIX_SERVER_NAME
const AS_TOKEN = env.OM_MATRIX_AS_TOKEN
const SENDER = `@${env.OM_MATRIX_SENDER_LOCALPART}:${SERVER}`
const BOT = `@${env.OM_MATRIX_BOT_LOCALPART}:${SERVER}`
const PREFIX = env.OM_MATRIX_USER_PREFIX

/** Mirrors the identity scheme in the spec: @om_u_<uuid without dashes>. */
const mxidFor = (uuid) => `@${PREFIX}u_${uuid.replace(/-/g, '').toLowerCase()}:${SERVER}`

/**
 * A transaction id derived from a stable Operis message id. Sending twice with
 * the same one must return the SAME event, which is what makes a retried
 * delivery safe. Matching the recovered prototype's deriveTransactionId.
 */
const txnFor = (id) => `om-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`

let passed = 0
let failed = 0
const failures = []

const pass = (name, detail = '') => {
  passed += 1
  process.stdout.write(`\x1b[32m  ✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}\n`)
}
const fail = (name, detail) => {
  failed += 1
  failures.push(`${name}: ${detail}`)
  process.stdout.write(`\x1b[31m  ✗ ${name}\x1b[0m\n     \x1b[31m${detail}\x1b[0m\n`)
}
const section = (name) => process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`)

async function check(name, fn, detail) {
  try {
    const result = await fn()
    pass(name, typeof detail === 'function' ? detail(result) : detail)
    return result
  } catch (error) {
    fail(name, error.message)
    return null
  }
}

async function api(method, endpoint, { body, asUser, query, rawBody, contentType } = {}) {
  const url = new URL(`${HS}${endpoint}`)
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
  if (asUser) url.searchParams.set('user_id', asUser)

  const headers = { authorization: `Bearer ${AS_TOKEN}`, accept: 'application/json' }
  let payload
  if (rawBody !== undefined) {
    payload = rawBody
    headers['content-type'] = contentType
  } else if (body !== undefined) {
    payload = JSON.stringify(body)
    headers['content-type'] = 'application/json'
  }

  const res = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(30_000) })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(`${res.status} ${parsed?.errcode ?? ''} ${parsed?.error ?? text.slice(0, 160)}`.trim())
    err.status = res.status
    err.errcode = parsed?.errcode
    throw err
  }
  return parsed
}

async function expectRejected(fn, why) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error(`expected a refusal (${why}) but the call succeeded`)
}

// ---------------------------------------------------------------------------

process.stdout.write(`\x1b[1mMatrix Phase 0 verification\x1b[0m  \x1b[90m${HS} · ${SERVER}\x1b[0m\n`)

const userA = mxidFor(randomUUID())
const userB = mxidFor(randomUUID())
let roomId = null

section('Homeserver')

await check(
  'client API reachable',
  async () => (await api('GET', '/_matrix/client/versions')).versions.at(-1),
  (v) => `Matrix ${v}`,
)

await check(
  'appservice token authenticates as its own sender',
  async () => {
    const who = await api('GET', '/_matrix/client/v3/account/whoami')
    if (who.user_id !== SENDER) throw new Error(`whoami returned ${who.user_id}, expected ${SENDER}`)
    return who.user_id
  },
  (id) => id,
)

await check('self-registration is disabled', async () => {
  const err = await expectRejected(
    () => api('POST', '/_matrix/client/v3/register', { body: { username: 'intruder', password: 'x'.repeat(20) } }),
    'enable_registration: false',
  )
  // The property under test is that it was refused. Synapse reports disabled
  // registration as M_FORBIDDEN or M_UNKNOWN depending on which guard fires
  // first, and pinning the exact code makes this fail on a Synapse upgrade for
  // no security reason.
  if (!err.status || err.status < 400) throw new Error(`unexpected outcome: ${err.message}`)
  return `${err.status} ${err.errcode ?? ''}`.trim()
}, (code) => `refused with ${code}`)

section('Identity and namespace')

await check('register a namespaced user', async () => {
  await api('POST', '/_matrix/client/v3/register', {
    body: { type: 'm.login.application_service', username: userA.slice(1).split(':')[0] },
  })
  return userA
}, () => userA)

await check('register a second namespaced user', async () => {
  await api('POST', '/_matrix/client/v3/register', {
    body: { type: 'm.login.application_service', username: userB.slice(1).split(':')[0] },
  })
  return userB
}, () => userB)

await check('register the sync bot', async () => {
  try {
    await api('POST', '/_matrix/client/v3/register', {
      body: { type: 'm.login.application_service', username: env.OM_MATRIX_BOT_LOCALPART },
    })
  } catch (error) {
    // Already registered by a previous run. Idempotent by intent.
    if (error.errcode !== 'M_USER_IN_USE') throw error
  }
  return BOT
}, () => BOT)

await check('homeserver refuses masquerade outside the namespace', async () => {
  const outsider = `@not_ours:${SERVER}`
  const err = await expectRejected(
    () => api('GET', '/_matrix/client/v3/account/whoami', { asUser: outsider }),
    'user is outside the exclusive namespace',
  )
  return err.errcode ?? String(err.status)
}, (code) => `refused with ${code}`)

await check('set a display name', async () => {
  await api('PUT', `/_matrix/client/v3/profile/${encodeURIComponent(userA)}/displayname`, {
    asUser: userA,
    body: { displayname: 'Verification User A' },
  })
  const profile = await api('GET', `/_matrix/client/v3/profile/${encodeURIComponent(userA)}`)
  if (profile.displayname !== 'Verification User A') throw new Error('display name did not stick')
  return profile.displayname
})

section('Room lifecycle')

roomId = await check('create a private room owned by the appservice bot', async () => {
  // The BOT creates the room, not a user.
  //
  // Two reasons, and the first is a hard constraint: the creator must hold
  // PL 100 during creation to write the room's own state events, so a room
  // created *as* an Operis owner and immediately demoted to 50 fails with
  // "user_level (50) < send_level (100)". The second is design: Operis is the
  // authority over the room, so a conversation must not be orphaned when the
  // person who started it leaves the organization.
  //
  // The Operis role model then sits underneath: owner 50, member 0.
  const room = await api('POST', '/_matrix/client/v3/createRoom', {
    asUser: BOT,
    body: {
      preset: 'private_chat',
      name: 'Phase 0 verification',
      power_level_content_override: {
        users: { [BOT]: 100, [userA]: 50 },
        users_default: 0,
        events_default: 0,
        state_default: 50,
        invite: 50,
        kick: 50,
        ban: 50,
        redact: 50,
      },
    },
  })
  return room.room_id
}, (id) => id)

await check('invite and join both users', async () => {
  for (const user of [userA, userB]) {
    await api('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      asUser: BOT,
      body: { user_id: user },
    })
    await api('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, { asUser: user, body: {} })
  }
  const members = await api('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`, {
    asUser: userA,
  })
  const joined = Object.keys(members.joined)
  // bot + two users.
  if (joined.length !== 3) throw new Error(`expected 3 joined members, got ${joined.length}: ${joined.join(', ')}`)
  return joined.length
}, (n) => `${n} members joined`)

await check('the Operis role model is enforced by the homeserver', async () => {
  const levels = await api(
    'GET',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`,
    { asUser: userA },
  )
  if (levels.users[BOT] !== 100) throw new Error('bot is not room admin')
  if (levels.users[userA] !== 50) throw new Error('owner is not PL 50')
  if (levels.users[userB] !== undefined) throw new Error('member should inherit users_default, not be listed')
  if (levels.users_default !== 0) throw new Error('members are not PL 0')

  // A plain member must not be able to kick. This is the property that makes
  // the homeserver a second enforcement point rather than decoration.
  const err = await expectRejected(
    () =>
      api('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, {
        asUser: userB,
        body: { user_id: userA },
      }),
    'member (PL 0) cannot kick (needs PL 50)',
  )
  return err.errcode
}, (code) => `member kick refused with ${code}`)

section('Messaging')

const messageId = randomUUID()
let firstEventId = null

firstEventId = await check('send a message with a derived transaction id', async () => {
  const sent = await api(
    'PUT',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnFor(messageId)}`,
    { asUser: userA, body: { msgtype: 'm.text', body: 'Hello from the appservice.' } },
  )
  return sent.event_id
}, (id) => id)

await check('resending the same transaction id returns the same event', async () => {
  const again = await api(
    'PUT',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnFor(messageId)}`,
    { asUser: userA, body: { msgtype: 'm.text', body: 'Hello from the appservice.' } },
  )
  if (again.event_id !== firstEventId) {
    throw new Error(`duplicate posted: ${again.event_id} !== ${firstEventId}`)
  }
  return again.event_id
}, 'no duplicate — retry is safe')

const replyEventId = await check('send a threaded reply', async () => {
  const sent = await api(
    'PUT',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnFor(randomUUID())}`,
    {
      asUser: userB,
      body: {
        msgtype: 'm.text',
        body: 'Replying to that.',
        'm.relates_to': { 'm.in_reply_to': { event_id: firstEventId } },
      },
    },
  )
  return sent.event_id
})

await check('react to a message', async () => {
  await api('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnFor(randomUUID())}`, {
    asUser: userB,
    body: { 'm.relates_to': { rel_type: 'm.annotation', event_id: firstEventId, key: '👍' } },
  })
  const relations = await api(
    'GET',
    `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(firstEventId)}/m.annotation`,
    { asUser: userA },
  )
  if (!relations.chunk.length) throw new Error('reaction did not come back as a relation')
  return relations.chunk[0].content['m.relates_to'].key
}, (key) => `read back as ${key}`)

await check('edit a message', async () => {
  await api(
    'PUT',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnFor(randomUUID())}`,
    {
      asUser: userA,
      body: {
        msgtype: 'm.text',
        body: '* Hello from the appservice, edited.',
        'm.new_content': { msgtype: 'm.text', body: 'Hello from the appservice, edited.' },
        'm.relates_to': { rel_type: 'm.replace', event_id: firstEventId },
      },
    },
  )
  const relations = await api(
    'GET',
    `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(firstEventId)}/m.replace`,
    { asUser: userA },
  )
  if (!relations.chunk.length) throw new Error('edit did not come back as a relation')
  return relations.chunk.length
})

await check('redact a message', async () => {
  const redaction = await api(
    'PUT',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(replyEventId)}/${txnFor(randomUUID())}`,
    { asUser: userB, body: { reason: 'verification' } },
  )
  const event = await api(
    'GET',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(replyEventId)}`,
    { asUser: userA },
  )
  if (Object.keys(event.content).length !== 0) throw new Error('redacted event still carries content')
  return redaction.event_id
}, 'content gone, event retained')

section('Reading')

await check('paginate the timeline backwards', async () => {
  const page = await api('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
    asUser: userA,
    query: { dir: 'b', limit: 10 },
  })
  if (!page.chunk.length) throw new Error('timeline came back empty')
  if (!page.end) throw new Error('no pagination token returned')
  return page.chunk.length
}, (n) => `${n} events, pagination token present`)

await check('set a read receipt and a fully-read marker', async () => {
  await api(
    'POST',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(firstEventId)}`,
    { asUser: userB, body: {} },
  )
  await api('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/read_markers`, {
    asUser: userB,
    body: { 'm.fully_read': firstEventId, 'm.read': firstEventId },
  })
  return true
})

section('Media')

await check('upload and download a file over authenticated media', async () => {
  const bytes = Buffer.from('operis phase 0 attachment payload')
  const uploaded = await api('POST', '/_matrix/media/v3/upload', {
    asUser: userA,
    query: { filename: 'phase0.txt' },
    rawBody: bytes,
    contentType: 'text/plain',
  })
  const mxc = uploaded.content_uri
  if (!mxc?.startsWith('mxc://')) throw new Error(`unexpected content_uri: ${mxc}`)

  const [, , server, mediaId] = mxc.split('/')
  const res = await fetch(`${HS}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
    headers: { authorization: `Bearer ${AS_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const roundTripped = Buffer.from(await res.arrayBuffer())
  if (!roundTripped.equals(bytes)) throw new Error('downloaded bytes differ from what was uploaded')
  return mxc
}, (mxc) => mxc)

section('Sync')

await check('/sync is refused for the appservice sender', async () => {
  // Synapse: "We no longer support AS users using /sync directly"
  // (matrix-doc#1144). Anything that needs to read a timeline has to be a
  // separate namespaced user — which is why OM_MATRIX_BOT_LOCALPART exists.
  const err = await expectRejected(
    () => api('GET', '/_matrix/client/v3/sync', { asUser: SENDER, query: { timeout: 0 } }),
    'sender_localpart cannot /sync',
  )
  return err.errcode ?? String(err.status)
}, (code) => `refused with ${code} — the bot user is required`)

await check('/sync works for the namespaced bot', async () => {
  const synced = await api('GET', '/_matrix/client/v3/sync', { asUser: BOT, query: { timeout: 0 } })
  if (!synced.next_batch) throw new Error('no next_batch token returned')
  return synced.next_batch
}, 'cursor returned')

await check('a joined member sees the room in /sync', async () => {
  const synced = await api('GET', '/_matrix/client/v3/sync', { asUser: userB, query: { timeout: 0 } })
  const joined = synced.rooms?.join ?? {}
  if (!joined[roomId]) throw new Error('room absent from the joined set')
  return Object.keys(joined).length
}, (n) => `${n} joined room(s)`)

// ---------------------------------------------------------------------------

process.stdout.write('\n')
if (failed === 0) {
  process.stdout.write(`\x1b[32m\x1b[1m✓ ${passed} checks passed\x1b[0m\n`)
  process.stdout.write(`\x1b[90m  room ${roomId}\n  inspect at http://127.0.0.1:8009\x1b[0m\n`)
  process.exit(0)
}
process.stdout.write(`\x1b[31m\x1b[1m✗ ${failed} of ${passed + failed} checks failed\x1b[0m\n`)
failures.forEach((f) => process.stdout.write(`\x1b[31m  · ${f}\x1b[0m\n`))
process.exit(1)
