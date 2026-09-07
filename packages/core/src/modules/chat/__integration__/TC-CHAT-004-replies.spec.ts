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
    name: `QA Reply ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

/**
 * TC-CHAT-004: replies, in both kinds of conversation and through the same
 * mechanism — plus the rule that a reply can never point outside the
 * conversation it lives in.
 */
test.describe('TC-CHAT-004: message replies', () => {
  test('replies work identically in a direct conversation and in a space, and survive a refetch', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Reply ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'bob')

      const direct = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      const directId = (await direct.json()).id as string

      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Replies', memberIds: [bob.id] },
      })
      const spaceId = (await space.json()).id as string

      // The same three steps against both kinds, because the whole point is that
      // there is one reply mechanism rather than two.
      for (const [label, conversationId] of [
        ['direct', directId],
        ['space', spaceId],
      ] as const) {
        const original = await apiRequest(
          request,
          'POST',
          `/api/chat/conversations/${conversationId}/messages`,
          { token: alice.token, data: { body: `Can we review this tomorrow? (${label})` } },
        )
        const originalId = (await original.json()).message.id as string

        const reply = await apiRequest(
          request,
          'POST',
          `/api/chat/conversations/${conversationId}/messages`,
          {
            token: bob.token,
            data: { body: `Yes, I will prepare the figures. (${label})`, replyToMessageId: originalId },
          },
        )
        expect(reply.ok(), `replying should work in a ${label} conversation`).toBeTruthy()
        const replyBody = (await reply.json()).message
        expect(replyBody.replyTo.id).toBe(originalId)
        expect(replyBody.replyTo.senderUserId).toBe(alice.id)
        expect(replyBody.replyTo.deleted).toBe(false)

        // The reference is structural: refetching resolves it again from the
        // database rather than from anything the sender supplied.
        const page = await apiRequest(
          request,
          'GET',
          `/api/chat/conversations/${conversationId}/messages`,
          { token: alice.token },
        )
        const stored = (await page.json()).items.find(
          (message: { id: string }) => message.id === replyBody.id,
        )
        expect(stored.replyTo.id, `the ${label} reply survives a refetch`).toBe(originalId)
        expect(stored.replyTo.body).toContain('Can we review this tomorrow?')
        // The quoted text is never copied into the reply's own body.
        expect(stored.body).not.toContain('Can we review this tomorrow?')
      }
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a reply cannot reference a message from another conversation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null
    let carol: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Forge ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'bob')
      carol = await createColleague(request, adminToken, organizationId, roleId, 'carol')

      // A space Alice and Bob share, and a private one Alice shares with Carol.
      const shared = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Shared', memberIds: [bob.id] },
      })
      const sharedId = (await shared.json()).id as string

      const private_ = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Private', memberIds: [carol.id] },
      })
      const privateId = (await private_.json()).id as string

      const secret = await apiRequest(request, 'POST', `/api/chat/conversations/${privateId}/messages`, {
        token: alice.token,
        data: { body: 'Confidential: the number is 42.' },
      })
      const secretId = (await secret.json()).message.id as string

      // Bob is in the shared space and knows (or guesses) an id from the private
      // one. Referencing it must fail — otherwise the reply would quote a line he
      // is not allowed to read straight into a space he is in.
      const forged = await apiRequest(request, 'POST', `/api/chat/conversations/${sharedId}/messages`, {
        token: bob.token,
        data: { body: 'look what I found', replyToMessageId: secretId },
      })
      expect(forged.status(), 'a cross-conversation reply target is refused').toBe(404)

      // Alice, who CAN read both, is refused just the same: the rule is about the
      // conversation the reply lives in, not about who is asking.
      const forgedByInsider = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${sharedId}/messages`,
        { token: alice.token, data: { body: 'crossing over', replyToMessageId: secretId } },
      )
      expect(forgedByInsider.status(), 'even a member of both conversations cannot bridge them').toBe(404)

      const fabricated = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${sharedId}/messages`,
        {
          token: bob.token,
          data: { body: 'nothing here', replyToMessageId: '11111111-1111-4111-8111-111111111111' },
        },
      )
      expect(fabricated.status()).toBe(404)
      expect(
        await fabricated.json(),
        'the same refusal either way, so this cannot be used to probe which ids exist',
      ).toEqual(await forged.json())

      const malformed = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${sharedId}/messages`,
        { token: bob.token, data: { body: 'nothing here', replyToMessageId: 'not-a-uuid' } },
      )
      expect(malformed.status(), 'a malformed id is rejected at the edge').toBe(400)

      // Nothing above was stored.
      const page = await apiRequest(request, 'GET', `/api/chat/conversations/${sharedId}/messages`, {
        token: alice.token,
      })
      expect((await page.json()).items, 'no forged reply was written').toHaveLength(0)
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteUserIfExists(request, adminToken, carol?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
