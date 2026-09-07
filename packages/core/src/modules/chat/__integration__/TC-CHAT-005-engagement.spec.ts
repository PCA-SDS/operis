import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

export const integrationMeta = { dependsOnModules: ['chat'] }

const PASSWORD = 'Valid1!Pass'

type Person = { id: string; email: string; token: string }

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
    name: `QA Engage ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

test.describe('TC-CHAT-005: reactions, mentions and pins', () => {
  test('reactions aggregate, toggle, and cannot be forged across conversations', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null
    let carol: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA React ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'bob')
      carol = await createColleague(request, adminToken, organizationId, roleId, 'carol')

      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Reactions', memberIds: [bob.id] },
      })
      const spaceId = (await space.json()).id as string

      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: alice.token,
        data: { body: 'React to me' },
      })
      const messageId = (await sent.json()).message.id as string

      const react = (token: string, emoji: string) =>
        apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages/${messageId}/reactions`, {
          token,
          data: { emoji },
        })

      await react(alice.token, '👍')
      await react(bob.token, '👍')
      await react(bob.token, '🎉')

      const read = async (token: string) => {
        const page = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/messages`, { token })
        const message = (await page.json()).items.find((m: { id: string }) => m.id === messageId)
        return message.reactions as Array<{ emoji: string; count: number; mine: boolean }>
      }

      const asAlice = await read(alice.token)
      expect(asAlice.find((r) => r.emoji === '👍')).toMatchObject({ count: 2, mine: true })
      expect(asAlice.find((r) => r.emoji === '🎉')).toMatchObject({ count: 1, mine: false })

      // `mine` is per viewer, not a property of the reaction.
      const asBob = await read(bob.token)
      expect(asBob.find((r) => r.emoji === '🎉')).toMatchObject({ count: 1, mine: true })

      // Pressing the same emoji again removes it rather than adding a duplicate.
      const toggled = await react(alice.token, '👍')
      expect((await toggled.json()).reacted).toBe(false)
      expect((await read(alice.token)).find((r) => r.emoji === '👍')).toMatchObject({
        count: 1,
        mine: false,
      })

      // Racing clicks converge on one row rather than erroring.
      const race = await Promise.all([react(alice.token, '🚀'), react(alice.token, '🚀')])
      for (const response of race) expect(response.status()).toBe(200)

      // A non-member cannot react, and cannot learn the message exists.
      const outsider = await react(carol.token, '👍')
      expect(outsider.status(), 'a non-member is told nothing').toBe(404)

      // Nor can a member of one conversation reach a message in another.
      const other = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Elsewhere', memberIds: [carol.id] },
      })
      const otherId = (await other.json()).id as string
      const crossed = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${otherId}/messages/${messageId}/reactions`,
        { token: alice.token, data: { emoji: '👍' } },
      )
      expect(crossed.status(), 'the message does not belong to that conversation').toBe(404)
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteUserIfExists(request, adminToken, carol?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('mentions are validated against the conversation, never trusted', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId: orgA } = getTokenContext(adminToken)

    let orgB: string | null = null
    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null
    let carol: Person | null = null
    let outsider: Person | null = null

    try {
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA Mention Org ${Date.now()}` })
      roleId = await createRoleFixture(request, adminToken, { name: `QA Mention ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, orgA, roleId, 'alice')
      bob = await createColleague(request, adminToken, orgA, roleId, 'bob')
      carol = await createColleague(request, adminToken, orgA, roleId, 'carol')
      outsider = await createColleague(request, adminToken, orgB, roleId, 'outsider')

      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Mentions', memberIds: [bob.id] },
      })
      const spaceId = (await space.json()).id as string

      const send = (body: string) =>
        apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
          token: alice!.token,
          data: { body },
        })

      // A member: allowed, and the name comes back resolved.
      const ok = await send(`<@${bob.id}> please look`)
      expect(ok.ok()).toBeTruthy()
      const stored = (await ok.json()).message
      expect(stored.mentionNames[bob.id]).toBeTruthy()
      // The body keeps the id, not the name — that is what survives a rename.
      expect(stored.body).toContain(`<@${bob.id}>`)

      // Someone in the organization but NOT in this conversation.
      expect((await send(`<@${carol.id}> hi`)).status()).toBe(400)
      // Someone in another organization.
      expect((await send(`<@${outsider.id}> hi`)).status()).toBe(400)
      // Someone who does not exist.
      expect((await send('<@11111111-1111-4111-8111-111111111111> hi')).status()).toBe(400)

      // @everyone belongs to a space, not to a two-person conversation.
      expect((await send('<@everyone> standup')).ok()).toBeTruthy()
      const direct = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      const directId = (await direct.json()).id as string
      const everyoneInDirect = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${directId}/messages`,
        { token: alice.token, data: { body: '<@everyone> hi' } },
      )
      expect(everyoneInDirect.status(), '@everyone means nothing in a direct').toBe(400)

      // Being named raises the unread that already exists rather than adding a
      // second counter.
      const list = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
        token: bob.token,
      })
      const row = (await list.json()).items.find((c: { id: string }) => c.id === spaceId)
      expect(row.unreadCount).toBeGreaterThan(0)
      expect(row.hasUnreadMention, 'bob was named, and @everyone reaches him too').toBe(true)

      // Alice named others, so nothing is waiting for her.
      const aliceList = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
        token: alice.token,
      })
      const aliceRow = (await aliceList.json()).items.find((c: { id: string }) => c.id === spaceId)
      expect(aliceRow.hasUnreadMention, 'you are not notified of your own mentions').toBe(false)

      // A member who has left can no longer be named.
      await apiRequest(request, 'DELETE', `/api/chat/conversations/${spaceId}/members/${bob.id}`, {
        token: alice.token,
      })
      expect((await send(`<@${bob.id}> still there?`)).status()).toBe(400)
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteUserIfExists(request, adminToken, carol?.id ?? null)
      await deleteUserIfExists(request, adminToken, outsider?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, orgB)
    }
  })

  test('a new member is not told they were named before they joined', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let owner: Person | null = null
    let latecomer: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Join ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      owner = await createColleague(request, adminToken, organizationId, roleId, 'owner')
      latecomer = await createColleague(request, adminToken, organizationId, roleId, 'late')

      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: owner.token,
        data: { kind: 'space', title: 'QA Late Join' },
      })
      expect(space.ok(), await space.text()).toBeTruthy()
      const spaceId = (await space.json()).id as string

      // Said to the room before the latecomer existed in it.
      await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: owner.token,
        data: { body: '<@everyone> standup now' },
      })

      const joined = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${spaceId}/members`,
        { token: owner.token, data: { memberIds: [latecomer.id] } },
      )
      // Asserted, so a change to the payload shape fails here loudly instead of
      // leaving the rest of the test quietly measuring a non-member.
      expect(joined.ok(), await joined.text()).toBeTruthy()

      const listFor = async (person: Person) => {
        const list = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
          token: person.token,
        })
        const row = (await list.json()).items.find((c: { id: string }) => c.id === spaceId)
        expect(row, 'the space is in their list at all').toBeDefined()
        return row as { hasUnreadMention: boolean }
      }

      expect(
        (await listFor(latecomer)).hasUnreadMention,
        'an everyone-mention sent before they joined did not name them',
      ).toBe(false)

      // But one sent afterwards does.
      await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: owner.token,
        data: { body: '<@everyone> welcome' },
      })
      expect(
        (await listFor(latecomer)).hasUnreadMention,
        'and one sent after they joined does',
      ).toBe(true)
    } finally {
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteUserIfExists(request, adminToken, latecomer?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('pins are owner-gated in a space, listed newest first, and reachable in history', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let owner: Person | null = null
    let member: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Pin ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      owner = await createColleague(request, adminToken, organizationId, roleId, 'owner')
      member = await createColleague(request, adminToken, organizationId, roleId, 'member')

      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: owner.token,
        data: { kind: 'space', title: 'QA Pins', memberIds: [member.id] },
      })
      const spaceId = (await space.json()).id as string

      const send = async (body: string) => {
        const response = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
          token: owner!.token,
          data: { body },
        })
        return (await response.json()).message.id as string
      }
      const first = await send('First, and soon far back in history')
      // Enough messages that the first falls outside a default page.
      for (let index = 0; index < 34; index += 1) await send(`filler ${index}`)
      const last = await send('Most recent')

      const pin = (token: string, messageId: string) =>
        apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages/${messageId}/pin`, { token })

      expect((await pin(member.token, last)).status(), 'a plain member cannot pin in a space').toBe(403)
      expect((await pin(owner.token, first)).ok()).toBeTruthy()
      expect((await pin(owner.token, last)).ok()).toBeTruthy()
      // Pinning twice is a no-op, not a second entry.
      expect((await pin(owner.token, last)).ok()).toBeTruthy()

      const pins = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/pins`, {
        token: member.token,
      })
      const body = await pins.json()
      expect(body.total, 'two pins, and the repeat added nothing').toBe(2)
      // Most recently pinned first.
      expect(body.items[0].messageId).toBe(last)
      expect(body.items[1].messageId).toBe(first)
      expect(body.items[0].pinnedByName).toBeTruthy()

      // The oldest pin is outside the newest page, so navigating to it needs a
      // window centred on the message rather than a walk through history.
      const newestPage = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/messages`, {
        token: member.token,
      })
      const newestIds = (await newestPage.json()).items.map((m: { id: string }) => m.id)
      expect(newestIds, 'the pinned message is beyond the default page').not.toContain(first)

      const around = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}/messages?around=${first}`,
        { token: member.token },
      )
      const window = await around.json()
      const windowIds = window.items.map((m: { id: string }) => m.id)
      expect(windowIds, 'the centred window contains it').toContain(first)
      expect(windowIds.length).toBeLessThan(20)

      // The message carries its own pin state, so the transcript can mark it.
      const pinnedInWindow = window.items.find((m: { id: string }) => m.id === first)
      expect(pinnedInWindow.pinned).toBe(true)

      const unpin = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/messages/${last}/pin`,
        { token: owner.token },
      )
      expect(unpin.ok()).toBeTruthy()
      const after = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/pins`, {
        token: owner.token,
      })
      expect((await after.json()).total).toBe(1)

      const conversation = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
        token: owner.token,
      })
      expect((await conversation.json()).pinnedCount, 'the header count follows').toBe(1)
    } finally {
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteUserIfExists(request, adminToken, member?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
