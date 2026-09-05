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

async function makePerson(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Person> {
  const email = `chat-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA ${label.toUpperCase()}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

/**
 * The whole collaboration loop in one pass: message → reply → mention → react →
 * pin → retrieve later, then revoke and confirm the door actually shuts.
 *
 * The per-feature specs (TC-CHAT-005) prove each rule in isolation. This one
 * exists because the features share a message and a membership list, and the
 * ways they break are ways they break *together* — a pin that survives its
 * reaction, a mention that outlives the membership it was validated against, a
 * removed member who keeps reading through an endpoint nobody re-checked.
 */
test.describe('TC-CHAT-006: the collaboration loop end to end', () => {
  test('four colleagues collaborate, then losing membership closes every door', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId: orgA } = getTokenContext(adminToken)

    let orgB: string | null = null
    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null
    let carol: Person | null = null
    let dan: Person | null = null
    let mallory: Person | null = null

    try {
      orgB = await createOrganizationFixture(request, adminToken, {
        name: `QA E2E Other Org ${Date.now()}`,
      })
      roleId = await createRoleFixture(request, adminToken, { name: `QA E2E ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['chat.view', 'chat.send'],
      })

      alice = await makePerson(request, adminToken, orgA, roleId, 'alice')
      bob = await makePerson(request, adminToken, orgA, roleId, 'bob')
      carol = await makePerson(request, adminToken, orgA, roleId, 'carol')
      dan = await makePerson(request, adminToken, orgA, roleId, 'dan')
      // Same role and password, different organization — the only thing that
      // should stop them is scoping.
      mallory = await makePerson(request, adminToken, orgB, roleId, 'mallory')

      // ---- 1. Alice opens a space with Bob, Carol and Dan --------------------
      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: {
          kind: 'space',
          title: 'QA Collaboration',
          memberIds: [bob.id, carol.id, dan.id],
        },
      })
      expect(created.ok()).toBeTruthy()
      const spaceId = (await created.json()).id as string

      const send = async (token: string, body: string, replyToMessageId?: string) => {
        const response = await apiRequest(
          request,
          'POST',
          `/api/chat/conversations/${spaceId}/messages`,
          { token, data: replyToMessageId ? { body, replyToMessageId } : { body } },
        )
        expect(response.ok(), `send failed: ${await response.text()}`).toBeTruthy()
        return (await response.json()).message as { id: string; body: string }
      }
      const react = (token: string, messageId: string, emoji: string) =>
        apiRequest(
          request,
          'POST',
          `/api/chat/conversations/${spaceId}/messages/${messageId}/reactions`,
          { token, data: { emoji } },
        )
      const readMessage = async (token: string, messageId: string) => {
        const page = await apiRequest(
          request,
          'GET',
          `/api/chat/conversations/${spaceId}/messages`,
          { token },
        )
        const items = (await page.json()).items as Array<Record<string, unknown>>
        return items.find((m) => m.id === messageId) as
          | { reactions: Array<{ emoji: string; count: number; mine: boolean }>; pinned: boolean }
          | undefined
      }

      // ---- 2-7. React, aggregate, un-react ----------------------------------
      const opener = await send(alice.token, 'Morning all')
      await react(bob.token, opener.id, '👍')
      await react(carol.token, opener.id, '👍')

      expect(
        (await readMessage(alice.token, opener.id))!.reactions.find((r) => r.emoji === '👍'),
      ).toMatchObject({ count: 2, mine: false })
      // The same row read by one of the two people behind it.
      expect(
        (await readMessage(bob.token, opener.id))!.reactions.find((r) => r.emoji === '👍'),
      ).toMatchObject({ count: 2, mine: true })

      await react(bob.token, opener.id, '👍') // toggles off
      expect(
        (await readMessage(alice.token, opener.id))!.reactions.find((r) => r.emoji === '👍'),
      ).toMatchObject({ count: 1 })
      // Bob's removal took only Bob's row.
      expect(
        (await readMessage(carol.token, opener.id))!.reactions.find((r) => r.emoji === '👍'),
      ).toMatchObject({ count: 1, mine: true })

      // ---- 8-9. A direct mention reaches exactly the person named -----------
      await send(alice.token, `<@${carol.id}> could you look at this?`)
      const unreadFor = async (person: Person) => {
        const list = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
          token: person.token,
        })
        return (await list.json()).items.find((c: { id: string }) => c.id === spaceId) as {
          unreadCount: number
          hasUnreadMention: boolean
        }
      }
      expect((await unreadFor(carol)).hasUnreadMention, 'Carol was named').toBe(true)
      expect((await unreadFor(dan)).hasUnreadMention, 'Dan was not').toBe(false)
      expect((await unreadFor(alice)).hasUnreadMention, 'nobody is notified of their own').toBe(
        false,
      )

      // ---- 10-11. @everyone reaches the room, not its author ----------------
      await send(alice.token, '<@everyone> standup in five')
      for (const person of [bob, carol, dan]) {
        expect((await unreadFor(person)).hasUnreadMention, `${person.email} is in the room`).toBe(
          true,
        )
      }
      expect((await unreadFor(alice)).hasUnreadMention, 'the sender is not').toBe(false)

      // ---- 12-14. Reply, react to the reply, pin the reply ------------------
      const reply = await send(bob.token, 'On my way', opener.id)
      await react(carol.token, reply.id, '🎉')
      const pinned = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${spaceId}/messages/${reply.id}/pin`,
        { token: alice.token },
      )
      expect(pinned.ok(), 'the space owner may pin').toBeTruthy()

      // ---- 15-17. The pin is visible to another member, with context --------
      const pins = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/pins`, {
        token: bob.token,
      })
      const pinBody = await pins.json()
      expect(pinBody.total).toBe(1)
      expect(pinBody.items[0].messageId).toBe(reply.id)
      expect(pinBody.items[0].isReply, 'the panel says this was a reply').toBe(true)
      expect(pinBody.items[0].pinnedByName).toBeTruthy()

      // ---- 18. And the message it points at is reachable --------------------
      const around = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}/messages?around=${reply.id}`,
        { token: bob.token },
      )
      const windowIds = (await around.json()).items.map((m: { id: string }) => m.id)
      expect(windowIds).toContain(reply.id)

      // Pinning did not disturb the reaction sitting on the same message.
      const afterPin = await readMessage(carol.token, reply.id)
      expect(afterPin!.pinned).toBe(true)
      expect(afterPin!.reactions.find((r) => r.emoji === '🎉')).toMatchObject({
        count: 1,
        mine: true,
      })

      // ---- 19-20. Unpin ----------------------------------------------------
      const unpinned = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/messages/${reply.id}/pin`,
        { token: alice.token },
      )
      expect(unpinned.ok()).toBeTruthy()
      const afterUnpin = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}/pins`,
        { token: bob.token },
      )
      expect((await afterUnpin.json()).total).toBe(0)
      // The reaction outlived the pin.
      expect((await readMessage(carol.token, reply.id))!.reactions).toHaveLength(1)

      // ---- 21-23. Re-pin, then re-read everything from scratch --------------
      await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${spaceId}/messages/${reply.id}/pin`,
        { token: alice.token },
      )
      const reread = await readMessage(carol.token, reply.id)
      expect(reread!.pinned, 'pin state is server-held, not client memory').toBe(true)
      expect(reread!.reactions.find((r) => r.emoji === '🎉')!.count).toBe(1)

      // ---- 26-30. Remove Carol; every door must shut ------------------------
      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/members/${carol.id}`,
        { token: alice.token },
      )
      expect(removed.ok()).toBeTruthy()

      const carolGone = [
        ['read messages', await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/messages`, { token: carol.token })],
        ['read pins', await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/pins`, { token: carol.token })],
        ['read conversation', await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, { token: carol.token })],
        ['react', await react(carol.token, opener.id, '😄')],
        ['pin', await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages/${opener.id}/pin`, { token: carol.token })],
        ['send', await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, { token: carol.token, data: { body: 'still here?' } })],
      ] as const
      for (const [what, response] of carolGone) {
        expect(response.status(), `a removed member must not ${what}`).toBe(404)
      }

      // She can no longer be named, either.
      const namingCarol = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${spaceId}/messages`,
        { token: alice.token, data: { body: `<@${carol.id}> ping` } },
      )
      expect(namingCarol.status(), 'a departed member is not mentionable').toBe(400)

      // And a later @everyone does not reach her.
      await send(alice.token, '<@everyone> after the removal')
      const carolList = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
        token: carol.token,
      })
      const carolRows = (await carolList.json()).items as Array<{ id: string }>
      expect(
        carolRows.find((c) => c.id === spaceId),
        'the space is gone from her list entirely',
      ).toBeUndefined()

      // ---- 31-37. The other organization gets nothing ----------------------
      const malloryDenied = [
        ['read messages', await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/messages`, { token: mallory.token })],
        ['read pins', await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/pins`, { token: mallory.token })],
        ['read conversation', await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, { token: mallory.token })],
        ['react', await react(mallory.token, opener.id, '👍')],
        ['pin', await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages/${opener.id}/pin`, { token: mallory.token })],
        ['unpin', await apiRequest(request, 'DELETE', `/api/chat/conversations/${spaceId}/messages/${reply.id}/pin`, { token: mallory.token })],
        ['send', await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, { token: mallory.token, data: { body: 'hello' } })],
      ] as const
      for (const [what, response] of malloryDenied) {
        expect(
          response.status(),
          `another organization must not ${what} — and must not learn it exists`,
        ).toBe(404)
      }

      // Nor can she be named into it.
      const namingMallory = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${spaceId}/messages`,
        { token: alice.token, data: { body: `<@${mallory.id}> hello` } },
      )
      expect(namingMallory.status(), 'cross-organization mention is refused').toBe(400)

      // ---- Direct messages still work alongside all of the above ------------
      const direct = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: dan.id },
      })
      const directId = (await direct.json()).id as string
      const dm = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${directId}/messages`,
        { token: alice.token, data: { body: 'direct still fine' } },
      )
      expect(dm.ok()).toBeTruthy()
      const dmId = (await dm.json()).message.id as string
      expect(
        (
          await apiRequest(
            request,
            'POST',
            `/api/chat/conversations/${directId}/messages/${dmId}/reactions`,
            { token: dan.token, data: { emoji: '👍' } },
          )
        ).ok(),
        'reactions work in a direct conversation too',
      ).toBeTruthy()
      expect(
        (
          await apiRequest(
            request,
            'POST',
            `/api/chat/conversations/${directId}/messages/${dmId}/pin`,
            { token: dan.token },
          )
        ).ok(),
        'either participant may pin in a direct conversation',
      ).toBeTruthy()
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteUserIfExists(request, adminToken, carol?.id ?? null)
      await deleteUserIfExists(request, adminToken, dan?.id ?? null)
      await deleteUserIfExists(request, adminToken, mallory?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, orgB)
    }
  })
})
