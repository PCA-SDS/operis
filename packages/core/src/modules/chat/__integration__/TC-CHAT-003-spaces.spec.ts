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
    name: `QA Space ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

/**
 * TC-CHAT-003: the space lifecycle with four people — create, message, add,
 * remove, rename — and the authorization rules that hold it together.
 *
 * Everything is created per run and torn down in `finally`, so the suite never
 * leans on seeded data and never collides with a parallel run.
 */
test.describe('TC-CHAT-003: internal group spaces', () => {
  test('four colleagues create a space, exchange messages, and membership changes take effect', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    expect(organizationId, 'the admin token should carry an organization').toBeTruthy()

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null
    let carol: Person | null = null
    let diana: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Space ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })

      alice = await createColleague(request, adminToken, organizationId, roleId, 'alice')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'bob')
      carol = await createColleague(request, adminToken, organizationId, roleId, 'carol')
      diana = await createColleague(request, adminToken, organizationId, roleId, 'diana')

      // 1. Alice creates the space with Bob and Carol.
      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Project Alpha', memberIds: [bob.id, carol.id] },
      })
      expect(created.ok()).toBeTruthy()
      const space = await created.json()
      const spaceId = space.id as string
      expect(space.kind).toBe('space')
      expect(space.title).toBe('QA Project Alpha')
      // The creator is seated as owner even though they never named themselves.
      expect(space.viewerRole).toBe('owner')
      expect(space.memberCount).toBe(3)

      // 2. All three members can reach it; nobody else can.
      for (const person of [alice, bob, carol]) {
        const read = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
          token: person.token,
        })
        expect(read.ok(), `${person.email} should be able to read the space`).toBeTruthy()
      }
      const outsider = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
        token: diana.token,
      })
      expect(outsider.status(), 'a non-member is told nothing, not even that it exists').toBe(404)

      // 3. Alice sends; Bob and Carol see it as unread, Alice does not.
      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: alice.token,
        data: { body: 'Kickoff at ten.' },
      })
      expect(sent.ok()).toBeTruthy()
      const firstMessageId = (await sent.json()).message.id as string

      for (const person of [bob, carol]) {
        const list = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
          token: person.token,
        })
        const row = (await list.json()).items.find((item: { id: string }) => item.id === spaceId)
        expect(row, `${person.email} should see the space in their list`).toBeTruthy()
        expect(row.unreadCount, 'a message from someone else is unread').toBe(1)
        expect(row.viewerRole, 'members are not owners').toBe('member')
      }
      const aliceList = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
        token: alice.token,
      })
      const aliceRow = (await aliceList.json()).items.find((item: { id: string }) => item.id === spaceId)
      expect(aliceRow.unreadCount, 'your own message is never unread to you').toBe(0)

      // 4. Bob replies to it, and the reference resolves to Alice's message.
      const replied = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: bob.token,
        data: { body: 'I will prepare the figures.', replyToMessageId: firstMessageId },
      })
      expect(replied.ok()).toBeTruthy()
      const reply = (await replied.json()).message
      expect(reply.replyTo.id).toBe(firstMessageId)
      expect(reply.replyTo.body).toContain('Kickoff at ten')
      // The body is the reply itself — the original is referenced, never copied in.
      expect(reply.body).toBe('I will prepare the figures.')

      // 5. A plain member cannot manage the space.
      const bobRename = await apiRequest(request, 'PATCH', `/api/chat/conversations/${spaceId}`, {
        token: bob.token,
        data: { title: 'Bob was here' },
      })
      expect(bobRename.status(), 'only owners rename').toBe(403)
      const bobAdd = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/members`, {
        token: bob.token,
        data: { memberIds: [diana.id] },
      })
      expect(bobAdd.status(), 'only owners add members').toBe(403)
      const bobRemove = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/members/${carol.id}`,
        { token: bob.token },
      )
      expect(bobRemove.status(), 'only owners remove members').toBe(403)
      const bobPromote = await apiRequest(
        request,
        'PATCH',
        `/api/chat/conversations/${spaceId}/members/${bob.id}`,
        { token: bob.token, data: { role: 'owner' } },
      )
      expect(bobPromote.status(), 'a member cannot promote themselves').toBe(403)

      // 6. Alice adds Diana, who gains access and the history that precedes her.
      const added = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/members`, {
        token: alice.token,
        data: { memberIds: [diana.id] },
      })
      expect(added.ok()).toBeTruthy()
      expect((await added.json()).added).toEqual([diana.id])

      const dianaMessages = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}/messages`,
        { token: diana.token },
      )
      expect(dianaMessages.ok(), 'a new member can read the space').toBeTruthy()
      const dianaBodies = (await dianaMessages.json()).items.map((m: { body: string }) => m.body)
      expect(dianaBodies).toContain('Kickoff at ten.')

      const dianaSent = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: diana.token,
        data: { body: 'Joining now.', replyToMessageId: firstMessageId },
      })
      expect(dianaSent.ok(), 'a new member can send and reply').toBeTruthy()

      // Adding the same person again converges rather than failing — two owners
      // pressing the button at once must not produce an error for one of them.
      const addedAgain = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/members`, {
        token: alice.token,
        data: { memberIds: [diana.id] },
      })
      expect(addedAgain.ok()).toBeTruthy()
      expect((await addedAgain.json()).added, 'already a member, so nothing to add').toEqual([])

      // 7. Alice removes Carol, who loses access on her very next request.
      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/members/${carol.id}`,
        { token: alice.token },
      )
      expect(removed.ok()).toBeTruthy()

      const carolRead = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
        token: carol.token,
      })
      expect(carolRead.status(), 'a removed member loses access immediately').toBe(404)
      const carolMessages = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}/messages`,
        { token: carol.token },
      )
      expect(carolMessages.status(), 'and cannot fetch the history either').toBe(404)
      const carolSend = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: carol.token,
        data: { body: 'Still here?' },
      })
      expect(carolSend.status(), 'and cannot post into it').toBe(404)
      const carolList = await apiRequest(request, 'GET', '/api/chat/conversations?limit=30', {
        token: carol.token,
      })
      expect(
        (await carolList.json()).items.map((item: { id: string }) => item.id),
        'the space is gone from their conversation list',
      ).not.toContain(spaceId)

      // Her messages survive her removal — they belong to the transcript.
      const afterRemoval = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${spaceId}/messages`,
        { token: alice.token },
      )
      const senders = (await afterRemoval.json()).items.map((m: { senderUserId: string }) => m.senderUserId)
      expect(senders, 'a removed member keeps authorship of what they sent').toContain(bob.id)

      // 8. Alice renames it, and every remaining member sees the new name.
      const renamed = await apiRequest(request, 'PATCH', `/api/chat/conversations/${spaceId}`, {
        token: alice.token,
        data: { title: 'QA Project Beta' },
      })
      expect(renamed.ok()).toBeTruthy()
      expect((await renamed.json()).title).toBe('QA Project Beta')

      for (const person of [bob, diana]) {
        const read = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
          token: person.token,
        })
        expect((await read.json()).title, `${person.email} sees the new name`).toBe('QA Project Beta')
      }
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteUserIfExists(request, adminToken, carol?.id ?? null)
      await deleteUserIfExists(request, adminToken, diana?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a space always keeps an owner', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Owner ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId, roleId, 'owner')
      bob = await createColleague(request, adminToken, organizationId, roleId, 'member')

      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Ownership', memberIds: [bob.id] },
      })
      const spaceId = (await created.json()).id as string

      // The sole owner cannot walk out and leave nobody able to manage it.
      const leave = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/members/${alice.id}`,
        { token: alice.token },
      )
      expect(leave.status(), 'the last owner cannot leave while members remain').toBe(400)

      // Nor step down into the same hole.
      const stepDown = await apiRequest(
        request,
        'PATCH',
        `/api/chat/conversations/${spaceId}/members/${alice.id}`,
        { token: alice.token, data: { role: 'member' } },
      )
      expect(stepDown.status(), 'the last owner cannot demote themselves').toBe(400)

      // Promoting someone is the way out, and then leaving works.
      const promote = await apiRequest(
        request,
        'PATCH',
        `/api/chat/conversations/${spaceId}/members/${bob.id}`,
        { token: alice.token, data: { role: 'owner' } },
      )
      expect(promote.ok()).toBeTruthy()

      const leaveNow = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${spaceId}/members/${alice.id}`,
        { token: alice.token },
      )
      expect(leaveNow.ok(), 'with a second owner in place, leaving is allowed').toBeTruthy()

      const afterLeaving = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
        token: alice.token,
      })
      expect(afterLeaving.status(), 'leaving ends access as surely as being removed').toBe(404)

      // Bob, now the owner, still has the space.
      const bobRead = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}`, {
        token: bob.token,
      })
      expect((await bobRead.json()).viewerRole).toBe('owner')
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  /**
   * Two owners pressing "Add" on the same person at the same moment.
   *
   * The unique index keeps the membership correct either way; what this guards
   * is the RESPONSE. Before the retry was added the loser of the race got a
   * bare 500 from the constraint — measured with six parallel adds, which left
   * one membership row and several server errors. Both callers did something
   * reasonable and both should be told it worked.
   */
  test('concurrent adds of the same person converge instead of erroring', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let owner: Person | null = null
    let coOwner: Person | null = null
    let target: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Race ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      owner = await createColleague(request, adminToken, organizationId, roleId, 'owner')
      coOwner = await createColleague(request, adminToken, organizationId, roleId, 'coowner')
      target = await createColleague(request, adminToken, organizationId, roleId, 'target')

      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: owner.token,
        data: { kind: 'space', title: 'QA Race', memberIds: [coOwner.id] },
      })
      const spaceId = (await created.json()).id as string
      await apiRequest(request, 'PATCH', `/api/chat/conversations/${spaceId}/members/${coOwner.id}`, {
        token: owner.token,
        data: { role: 'owner' },
      })

      const add = (token: string) =>
        apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/members`, {
          token,
          data: { memberIds: [target!.id] },
        })

      const responses = await Promise.all([add(owner.token), add(coOwner.token), add(owner.token)])
      for (const response of responses) {
        expect(response.status(), 'a losing racer is still told it worked').toBe(200)
      }
      // Exactly one of them reports having done the seating.
      const addedCounts = await Promise.all(responses.map(async (r) => ((await r.json()).added as string[]).length))
      expect(addedCounts.filter((n) => n === 1)).toHaveLength(1)
      expect(addedCounts.filter((n) => n === 0)).toHaveLength(2)

      // And the membership is right: one row, not three.
      const members = await apiRequest(request, 'GET', `/api/chat/conversations/${spaceId}/members`, {
        token: owner.token,
      })
      const body = await members.json()
      expect(body.items.filter((m: { id: string }) => m.id === target!.id)).toHaveLength(1)
      expect(body.total).toBe(3)
    } finally {
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteUserIfExists(request, adminToken, coOwner?.id ?? null)
      await deleteUserIfExists(request, adminToken, target?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a space never reaches outside its own organization', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId: orgA } = getTokenContext(adminToken)

    let orgB: string | null = null
    let roleId: string | null = null
    let alice: Person | null = null
    let outsider: Person | null = null

    try {
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA Space Org ${Date.now()}` })
      roleId = await createRoleFixture(request, adminToken, { name: `QA Space Iso ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })

      alice = await createColleague(request, adminToken, orgA, roleId, 'inside')
      outsider = await createColleague(request, adminToken, orgB, roleId, 'outside')

      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Private Space' },
      })
      const spaceId = (await created.json()).id as string

      // Naming another organization's user is refused, and the message says
      // nothing about whether that id exists.
      const crossOrgAdd = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/members`, {
        token: alice.token,
        data: { memberIds: [outsider.id] },
      })
      expect(crossOrgAdd.status(), 'a user from another organization cannot be added').toBe(400)

      const fabricated = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/members`, {
        token: alice.token,
        data: { memberIds: ['11111111-1111-4111-8111-111111111111'] },
      })
      expect(fabricated.status()).toBe(400)
      expect(
        await fabricated.json(),
        'the same refusal either way, so this cannot be used to probe who exists',
      ).toEqual(await crossOrgAdd.json())

      // And the outsider cannot reach the space by any route.
      for (const [method, path] of [
        ['GET', `/api/chat/conversations/${spaceId}`],
        ['GET', `/api/chat/conversations/${spaceId}/messages`],
        ['GET', `/api/chat/conversations/${spaceId}/members`],
      ] as const) {
        const response = await apiRequest(request, method, path, { token: outsider.token })
        expect(response.status(), `${method} ${path} must not cross the boundary`).toBe(404)
      }

      const outsiderSend = await apiRequest(
        request,
        'POST',
        `/api/chat/conversations/${spaceId}/messages`,
        { token: outsider.token, data: { body: 'let me in' } },
      )
      expect(outsiderSend.status()).toBe(404)

      const outsiderRename = await apiRequest(request, 'PATCH', `/api/chat/conversations/${spaceId}`, {
        token: outsider.token,
        data: { title: 'taken' },
      })
      expect(outsiderRename.status()).toBe(404)

      // The directory never offers them either.
      const directory = await apiRequest(request, 'GET', '/api/chat/directory?q=QA%20Space%20outside', {
        token: alice.token,
      })
      expect(
        (await directory.json()).items.map((item: { id: string }) => item.id),
        'another organization never appears in the picker',
      ).not.toContain(outsider.id)
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, outsider?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, orgB)
    }
  })
})
