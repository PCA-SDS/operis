import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-002: the Inbox — created on first read, exactly one per scope, and
 * protected from the edits that would break Quick Add's default destination.
 */
test.describe('TC-TASKS-002: the Inbox project', () => {
  test('is created lazily and returns the same project every time', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const first = await apiRequest(request, 'GET', '/api/tasks/inbox', { token })
    expect(first.ok()).toBeTruthy()
    const inbox = await first.json()
    expect(inbox.isInbox).toBe(true)
    expect(inbox.key).toMatch(/^INBOX/)

    const second = await apiRequest(request, 'GET', '/api/tasks/inbox', { token })
    expect((await second.json()).id).toBe(inbox.id)
  })

  test('never appears in the project list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    await apiRequest(request, 'GET', '/api/tasks/inbox', { token })

    for (const filter of ['active', 'archived', 'all']) {
      const list = await apiRequest(request, 'GET', `/api/tasks/projects?archived=${filter}&pageSize=100`, {
        token,
      })
      const items = (await list.json()).items as { isInbox: boolean }[]
      expect(items.every((item) => item.isInbox === false), `filter=${filter}`).toBe(true)
    }
  })

  test('rejects rename, archive and delete', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const inbox = await (await apiRequest(request, 'GET', '/api/tasks/inbox', { token })).json()

    const renamed = await apiRequest(request, 'PATCH', `/api/tasks/projects/${inbox.id}`, {
      token,
      data: { name: 'Not the inbox' },
    })
    expect(renamed.status()).toBe(400)

    const archived = await apiRequest(request, 'PATCH', `/api/tasks/projects/${inbox.id}/archive`, {
      token,
      data: { archived: true },
    })
    expect(archived.status()).toBe(400)

    const deleted = await apiRequest(request, 'DELETE', `/api/tasks/projects/${inbox.id}`, { token })
    expect(deleted.status()).toBe(400)

    // Still intact after all three attempts.
    const stillThere = await apiRequest(request, 'GET', `/api/tasks/projects/${inbox.id}`, { token })
    expect((await stillThere.json()).name).toBe(inbox.name)
  })
})
