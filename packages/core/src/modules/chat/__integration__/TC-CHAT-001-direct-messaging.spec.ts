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

export const integrationMeta = { dependsOnModules: ['chat'] }

// Satisfies the default password policy (`buildPasswordSchema`): length, a
// digit, an uppercase letter and a symbol. `secret` is rejected with a 400.
const PASSWORD = 'Valid1!Pass'

type Person = { id: string; email: string; token: string }

/**
 * Two colleagues in one organization, created per run so the suite never leans
 * on seeded data and never collides with a parallel run.
 */
async function createColleague(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Person> {
  const email = `chat-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA Chat ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

/**
 * TC-CHAT-001: the end-to-end direct-messaging flow between two people in the
 * same organization — discovery, the canonical conversation, delivery, unread
 * state, and the reply coming back.
 */
test.describe('TC-CHAT-001: direct messaging between colleagues', () => {
  test('two colleagues discover each other, exchange messages and unread clears on read', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    // The admin's own organization, read from their token rather than from an
    // endpoint — the JWT already carries the scope every chat request is pinned to.
    const { organizationId } = getTokenContext(adminToken)
    expect(organizationId, 'the admin token should carry an organization').toBeTruthy()

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Chat ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })

      alice = await createColleague(request, adminToken, organizationId, roleId, 'alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'bob')

      // 1. Alice finds Bob in the directory, and never herself.
      const directory = await apiRequest(
        request,
        'GET',
        `/api/chat/directory?q=${encodeURIComponent('QA Chat bob')}`,
        { token: alice.token },
      )
      expect(directory.ok()).toBeTruthy()
      const directoryIds = (await directory.json()).items.map((item: { id: string }) => item.id)
      expect(directoryIds).toContain(bob.id)
      expect(directoryIds).not.toContain(alice.id)

      // 2. Opening the conversation is idempotent, from either side.
      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect(opened.ok()).toBeTruthy()
      const conversationId = (await opened.json()).id as string
      expect(conversationId).toBeTruthy()

      const reopened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect((await reopened.json()).id).toBe(conversationId)

      // The canonical-pair rule: Bob starting the chat lands on the same row.
      const fromBob = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: bob.token,
        data: { userId: alice.id },
      })
      expect((await fromBob.json()).id).toBe(conversationId)

      // Concurrent creation must not fork it either.
      const [raceA, raceB] = await Promise.all([
        apiRequest(request, 'POST', '/api/chat/conversations', {
          token: alice.token,
          data: { userId: bob.id },
        }),
        apiRequest(request, 'POST', '/api/chat/conversations', {
          token: bob.token,
          data: { userId: alice.id },
        }),
      ])
      expect((await raceA.json()).id).toBe(conversationId)
      expect((await raceB.json()).id).toBe(conversationId)

      // 3. Alice sends a message.
      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: alice.token,
        data: { body: 'Standup in five?', clientMessageId: 'qa-message-1' },
      })
      expect(sent.ok()).toBeTruthy()
      const sentBody = await sent.json()
      expect(sentBody.message.body).toBe('Standup in five?')
      expect(sentBody.deduplicated).toBe(false)

      // A retry with the same idempotency key must not post twice.
      const retried = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: alice.token,
        data: { body: 'Standup in five?', clientMessageId: 'qa-message-1' },
      })
      expect((await retried.json()).deduplicated).toBe(true)

      const afterRetry = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token },
      )
      expect((await afterRetry.json()).items).toHaveLength(1)

      // 4. Bob receives it, and it is unread for him but not for Alice.
      const bobMessages = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: bob.token },
      )
      expect(bobMessages.ok()).toBeTruthy()
      expect((await bobMessages.json()).items[0].body).toBe('Standup in five?')

      const bobUnread = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await bobUnread.json()).unreadCount).toBe(1)

      const aliceUnread = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: alice.token })
      expect((await aliceUnread.json()).unreadCount).toBe(0)

      // 5. Bob opens the conversation; unread clears and stays cleared.
      const read = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/read`, {
        token: bob.token,
        data: {},
      })
      expect(read.ok()).toBeTruthy()

      const bobUnreadAfter = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await bobUnreadAfter.json()).unreadCount).toBe(0)

      // A fresh session sees the same state — unread lives on the server.
      const bobSecondSession = await getAuthToken(request, bob.email, PASSWORD)
      const bobUnreadElsewhere = await apiRequest(request, 'GET', '/api/chat/unread-count', {
        token: bobSecondSession,
      })
      expect((await bobUnreadElsewhere.json()).unreadCount).toBe(0)

      // 6. Bob replies; now Alice has the unread.
      const reply = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: bob.token,
        data: { body: 'On my way' },
      })
      expect(reply.ok()).toBeTruthy()

      const aliceUnreadAfter = await apiRequest(request, 'GET', '/api/chat/unread-count', {
        token: alice.token,
      })
      expect((await aliceUnreadAfter.json()).unreadCount).toBe(1)

      // 7. The transcript is chronological and complete for both sides.
      const transcript = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token },
      )
      const bodies = (await transcript.json()).items.map((item: { body: string }) => item.body)
      expect(bodies).toEqual(['Standup in five?', 'On my way'])

      // 8. The conversation list shows the counterpart, the preview and the unread count.
      const list = await apiRequest(request, 'GET', '/api/chat/conversations', { token: alice.token })
      const row = (await list.json()).items.find((item: { id: string }) => item.id === conversationId)
      expect(row).toBeTruthy()
      expect(row.counterpart.id).toBe(bob.id)
      expect(row.lastMessagePreview).toBe('On my way')
      expect(row.unreadCount).toBe(1)
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  /**
   * The unread aggregate, against a real database.
   *
   * These moved out of the service unit tests when unread counting became a
   * Kysely `GROUP BY` over a join: a fake EntityManager cannot run that, so the
   * only honest place to assert it is here.
   */
  test('derives unread from the read cursor', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Chat U ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'u-alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'u-bob')

      // A brand-new user is in no conversations at all.
      const emptyUnread = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await emptyUnread.json()).unreadCount).toBe(0)

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      const conversationId = (await opened.json()).id as string

      // Never opened: everything from the other person counts.
      for (const body of ['one', 'two', 'three']) {
        await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
          token: alice.token,
          data: { body },
        })
      }
      const beforeRead = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await beforeRead.json()).unreadCount).toBe(3)

      // Alice's own three messages are never unread to Alice.
      const senderUnread = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: alice.token })
      expect((await senderUnread.json()).unreadCount).toBe(0)

      // The per-conversation count on the list agrees with the global total.
      const listBefore = await apiRequest(request, 'GET', '/api/chat/conversations', { token: bob.token })
      const rowBefore = (await listBefore.json()).items.find((i: { id: string }) => i.id === conversationId)
      expect(rowBefore.unreadCount).toBe(3)

      // Read up to the second message only — the cursor is a timestamp, so the
      // third stays unread.
      const page = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/messages`, {
        token: bob.token,
      })
      const messages = (await page.json()).items as Array<{ createdAt: string }>
      await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/read`, {
        token: bob.token,
        data: { readAt: messages[1].createdAt },
      })
      const partial = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await partial.json()).unreadCount).toBe(1)

      // The cursor never moves backwards.
      await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/read`, {
        token: bob.token,
        data: { readAt: messages[0].createdAt },
      })
      const afterRewind = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await afterRewind.json()).unreadCount).toBe(1)

      // A far-future cursor is clamped to the database clock rather than
      // accepted. Without the clamp, one bad client — or one instance running
      // ahead of the others — could mark everything read forever, which is the
      // same "permanently invisible" symptom the DB-sourced timestamps remove.
      const clamped = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/read`, {
        token: bob.token,
        data: { readAt: '2999-01-01T00:00:00.000Z' },
      })
      expect(clamped.ok()).toBeTruthy()
      expect(new Date((await clamped.json()).lastReadAt).getFullYear()).toBeLessThan(2100)

      // And a message sent after that clamped read is still unread, which it
      // would not be had the year-2999 cursor been stored.
      await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: alice.token,
        data: { body: 'after the clamped read' },
      })
      const afterClamp = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await afterClamp.json()).unreadCount).toBeGreaterThan(0)

      // Message timestamps come from the database and carry millisecond
      // precision, so a keyset cursor built from one round-trips losslessly.
      const stamped = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: bob.token },
      )
      for (const item of (await stamped.json()).items as Array<{ createdAt: string }>) {
        expect(item.createdAt).toBe(new Date(item.createdAt).toISOString())
      }
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  /**
   * The conversation list is a bounded top-N, not a cursor walk.
   *
   * `last_message_at` is rewritten by every send, so a descending keyset could
   * not return a conversation that had moved *above* the cursor — a chat bumped
   * between two page fetches disappeared from the list at the moment it became
   * most relevant. This reproduces that bump and asserts it stays visible.
   */
  test('keeps a bumped conversation visible and never duplicates it', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    const others: Person[] = []

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Chat P ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'p-alice')
      for (const label of ['p-one', 'p-two', 'p-three']) {
        others.push(await createColleague(request, adminToken, organizationId, roleId, label))
      }

      // Three conversations, opened oldest-first so their activity order is known.
      const conversationIds: string[] = []
      for (const other of others) {
        const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
          token: alice.token,
          data: { userId: other.id },
        })
        const id = (await opened.json()).id as string
        conversationIds.push(id)
        await apiRequest(request, 'POST', `/api/chat/conversations/${id}/messages`, {
          token: alice.token,
          data: { body: `opening ${id}` },
        })
      }
      const [oldest, , newest] = conversationIds

      // A first page of two reports that more exist.
      const firstPage = await apiRequest(request, 'GET', '/api/chat/conversations?limit=2', {
        token: alice.token,
      })
      const firstBody = await firstPage.json()
      expect(firstBody.items).toHaveLength(2)
      expect(firstBody.hasMore).toBe(true)
      // Most recent first: the last conversation opened leads.
      expect(firstBody.items[0].id).toBe(newest)
      // The oldest is below the limit — this is the row the keyset used to lose.
      expect(firstBody.items.map((item: { id: string }) => item.id)).not.toContain(oldest)

      // Bump it above the others.
      await apiRequest(request, 'POST', `/api/chat/conversations/${oldest}/messages`, {
        token: alice.token,
        data: { body: 'bumped to the top' },
      })

      // It must now lead the very same limited request. Under the old cursor it
      // was absent from page 2 and stale in page 1, so it vanished entirely.
      const afterBump = await apiRequest(request, 'GET', '/api/chat/conversations?limit=2', {
        token: alice.token,
      })
      const afterBody = await afterBump.json()
      expect(afterBody.items[0].id).toBe(oldest)
      expect(afterBody.items[0].lastMessagePreview).toBe('bumped to the top')

      // Growing the limit returns every conversation exactly once.
      const full = await apiRequest(request, 'GET', '/api/chat/conversations?limit=50', {
        token: alice.token,
      })
      const fullBody = await full.json()
      const ids = fullBody.items.map((item: { id: string }) => item.id)
      for (const id of conversationIds) expect(ids).toContain(id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(fullBody.hasMore).toBe(false)
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      for (const other of others) await deleteUserIfExists(request, adminToken, other.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('rejects messages the server should never store', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    // The admin's own organization, read from their token rather than from an
    // endpoint — the JWT already carries the scope every chat request is pinned to.
    const { organizationId } = getTokenContext(adminToken)
    expect(organizationId, 'the admin token should carry an organization').toBeTruthy()

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Chat V ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'v-alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'v-bob')

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      const conversationId = (await opened.json()).id as string

      const blank = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: alice.token,
        data: { body: '   \n  ' },
      })
      expect(blank.status(), 'a whitespace-only message is not a message').toBe(400)

      const tooLong = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: alice.token,
        data: { body: 'x'.repeat(5000) },
      })
      expect(tooLong.status(), 'the length cap is enforced server-side').toBe(400)

      const self = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: alice.id },
      })
      expect(self.status(), 'a conversation with yourself is refused').toBe(400)
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
