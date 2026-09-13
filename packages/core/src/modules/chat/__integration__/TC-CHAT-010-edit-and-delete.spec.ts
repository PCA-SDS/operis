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
    name: `QA Edit ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

test.describe('TC-CHAT-010: editing and deleting messages', () => {
  test('an author rewrites their own message and nobody else may', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Edit ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'bob')

      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Edits', memberIds: [bob.id] },
      })
      const spaceId = (await created.json()).id as string

      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: alice.token,
        // Distinctive nonce words, so the search assertions below turn on this
        // message's own text rather than on how the ranker treats common ones.
        data: { body: 'standup zebrafish https://example.test/old' },
      })
      const messageId = (await sent.json()).message.id as string

      const read = async (token: string) => {
        const page = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/messages`, {
          token,
        })
        return (await page.json()).items.find((m: { id: string }) => m.id === messageId)
      }

      expect((await read(alice.token)).editedAt, 'nothing claims to be edited yet').toBeNull()

      const edit = await apiRequest(
        request,
        'PATCH',
        `/api/chat/conversations/${spaceId}/messages/${messageId}`,
        { token: alice.token, data: { body: 'standup narwhal https://example.test/new' } },
      )
      expect(edit.ok()).toBeTruthy()

      const edited = await read(bob.token)
      expect(edited.body, 'everyone in the space sees the new wording').toBe(
        'standup narwhal https://example.test/new',
      )
      expect(edited.editedAt, 'and knows the words changed').not.toBeNull()

      // The search document is rebuilt with the body: a message must not stay
      // findable by words it no longer contains.
      const searchToken = alice.token
      const hitsFor = async (needle: string) => {
        const found = await apiRequest(
          request,
          'GET',
          `/api/chat/conversations/${spaceId}/search?q=${encodeURIComponent(needle)}`,
          { token: searchToken },
        )
        return (await found.json()).items.map((hit: { messageId: string }) => hit.messageId)
      }
      expect(await hitsFor('zebrafish'), 'the old wording no longer finds it').not.toContain(
        messageId,
      )
      expect(await hitsFor('narwhal'), 'the new wording does').toContain(messageId)

      // The link index follows too, so the Shared panel stops offering a URL
      // that has been taken out.
      const shared = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}/shared?kind=links`,
        { token: alice.token },
      )
      const urls = (await shared.json()).items.map((item: { url: string }) => item.url)
      expect(urls).toContain('https://example.test/new')
      expect(urls).not.toContain('https://example.test/old')

      // Rewriting somebody's words puts sentences in their mouth. Deliberately
      // narrower than deletion, and a space owner does not get an exception.
      const forbidden = await apiRequest(
        request,
        'PATCH',
        `/api/chat/conversations/${spaceId}/messages/${messageId}`,
        { token: bob.token, data: { body: 'alice said something else' } },
      )
      expect(forbidden.status()).toBe(403)
      expect((await read(alice.token)).body).toBe('standup narwhal https://example.test/new')

      // An edit that emptied the body would be a deletion by another name.
      const emptied = await apiRequest(
        request,
        'PATCH',
        `/api/chat/conversations/${spaceId}/messages/${messageId}`,
        { token: alice.token, data: { body: '   ' } },
      )
      expect(emptied.ok()).toBeFalsy()
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a deleted message leaves the transcript, its pin and the preview', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let owner: Person | null = null
    let member: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Delete ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      owner = await createColleague(request, adminToken, organizationId, roleId, 'owner')
      member = await createColleague(request, adminToken, organizationId, roleId, 'member')

      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: owner.token,
        data: { kind: 'space', title: 'QA Deletes', memberIds: [member.id] },
      })
      const spaceId = (await created.json()).id as string

      const send = async (token: string, body: string, replyToMessageId?: string) => {
        const response = await apiRequest(
          request,
          'POST',
          `/api/chat/conversations/${spaceId}/messages`,
          { token, data: { body, replyToMessageId } },
        )
        return (await response.json()).message.id as string
      }

      const first = await send(owner.token, 'the first thing said')
      const doomed = await send(member.token, 'something to take back')
      const reply = await send(owner.token, 'quoting you', doomed)

      await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${spaceId}/messages/${doomed}/pin`,
        { token: owner.token },
      )
      const pinnedBefore = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
        token: owner.token,
      })
      expect((await pinnedBefore.json()).pinnedCount).toBe(1)

      // An ordinary member may not remove somebody else's message.
      const refused = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/messages/${first}`,
        { token: member.token },
      )
      expect(refused.status()).toBe(403)

      // The author always may.
      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/messages/${doomed}`,
        { token: member.token },
      )
      expect(removed.ok()).toBeTruthy()

      const page = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/messages`, {
        token: owner.token,
      })
      const items = (await page.json()).items as Array<{ id: string; replyTo: unknown }>
      expect(items.map((m) => m.id), 'it is gone from the transcript').not.toContain(doomed)

      // The reply survives with its reference intact but unreadable, rather than
      // losing the context that made it make sense.
      const quoting = items.find((m) => m.id === reply) as {
        replyTo: { deleted: boolean; body: string }
      }
      expect(quoting.replyTo.deleted).toBe(true)
      expect(quoting.replyTo.body).toBe('')

      // The pinned panel already hides it, but the header count is a plain
      // count — so the pin row itself has to go.
      const conversation = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
        token: owner.token,
      })
      const state = await conversation.json()
      expect(state.pinnedCount, 'the pin goes with the message').toBe(0)
      expect(state.lastMessagePreview, 'the list previews what is actually newest').toBe(
        'quoting you',
      )

      // Deleting something already deleted converges rather than erroring: a
      // space owner and the author may press it at the same moment.
      const again = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/messages/${doomed}`,
        { token: owner.token },
      )
      expect(again.ok()).toBeTruthy()

      // Removing a message is moderation, and a space has owners for exactly
      // that class of decision.
      const moderated = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/messages/${reply}`,
        { token: owner.token },
      )
      expect(moderated.ok()).toBeTruthy()

      const afterModeration = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}`,
        { token: owner.token },
      )
      expect(
        (await afterModeration.json()).lastMessagePreview,
        'the preview falls back to the message below it',
      ).toBe('the first thing said')
    } finally {
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteUserIfExists(request, adminToken, member?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
