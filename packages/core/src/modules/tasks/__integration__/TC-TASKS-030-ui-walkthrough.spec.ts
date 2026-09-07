import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  createTask,
  uniqueProjectKey,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-030: the operator walkthrough — open the module, create work through
 * the UI, move it, and confirm it is still there after a reload.
 *
 * The reload assertions are the point: a board that only reorders local React
 * state would pass every click but fail here.
 */
test.describe('TC-TASKS-030: end-to-end walkthrough', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('creates a project from the UI and lands on its board', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []
    const key = uniqueProjectKey('UI')
    const name = `UI Project ${key}`

    try {
      await page.goto('/backend/tasks/projects')
      await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible()

      await page.getByRole('button', { name: /new project/i }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await dialog.getByLabel(/^key$/i).fill(key)
      await dialog.getByLabel(/^name$/i).fill(name)
      await dialog.getByRole('button', { name: /create project/i }).click()

      await page.waitForURL(/\/backend\/tasks\/projects\/[0-9a-f-]{36}/)
      await expect(page.getByRole('heading', { name })).toBeVisible()

      const created = await apiRequest(request, 'GET', '/api/tasks/projects?pageSize=100', { token })
      const match = ((await created.json()).items as { id: string; key: string }[]).find(
        (item) => item.key === key,
      )
      expect(match, 'the project should exist server-side').toBeTruthy()
      if (match) projectIds.push(match.id)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('adds a task with Quick Add and finds it after a reload', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []
    const title = `Quick added ${Date.now()}`

    try {
      await page.goto('/backend/tasks/today')
      await expect(page.getByRole('heading', { name: /today/i })).toBeVisible()

      await page.getByRole('button', { name: /add task/i }).first().click()
      const composer = page.getByRole('textbox', { name: /task name/i })
      await expect(composer).toBeVisible()
      await composer.fill(`${title} today`)
      await composer.press('Enter')

      // The composer routes to a view that shows the new task. Match the row
      // button, not any text: the composer's own textarea still holds the
      // typed title as its value.
      const row = page.getByRole('button', { name: title, exact: true })
      await expect(row).toBeVisible({ timeout: 15000 })

      await page.reload()
      await expect(row).toBeVisible({ timeout: 15000 })

      // Confirm it is a real row, not just rendered optimistically.
      const list = await apiRequest(request, 'GET', '/api/tasks/my-tasks?view=all&pageSize=100&tz=UTC', {
        token,
      })
      const items = (await list.json()).items as { title: string; projectId: string }[]
      const created = items.find((item) => item.title === title)
      expect(created, 'the quick-added task should exist server-side').toBeTruthy()
      if (created) projectIds.push(created.projectId)
    } finally {
      // Quick Add lands in the Inbox, which must never be deleted; only remove
      // a project if the task landed in a real one.
      const inbox = await (await apiRequest(request, 'GET', '/api/tasks/inbox', { token })).json()
      await cleanupTasks(ctx, { projectIds: projectIds.filter((id) => id !== inbox.id) })
    }
  })

  test('opens a task, changes its status, and keeps the change after a reload', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id, { title: 'Status walkthrough', status: 'backlog' })

      await page.goto(`/backend/tasks/projects/${project.id}?tab=list`)
      await page.getByRole('button', { name: 'Status walkthrough' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await dialog.getByRole('button', { name: /backlog/i }).first().click()
      await page.getByRole('option', { name: /in progress/i }).click()

      await expect
        .poll(async () => {
          const detail = await (
            await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
          ).json()
          return detail.status
        }, { timeout: 15000 })
        .toBe('in_progress')

      await page.reload()
      await page.goto(`/backend/tasks/projects/${project.id}?tab=board`)
      await expect(page.getByText('Status walkthrough')).toBeVisible()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('shows every board column and its counts', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      await createTask(ctx, project.id, { title: 'Board one', status: 'backlog' })
      await createTask(ctx, project.id, { title: 'Board two', status: 'in_progress' })

      await page.goto(`/backend/tasks/projects/${project.id}?tab=board`)

      for (const column of ['Backlog', 'To Do', 'In Progress', 'Blocked', 'In Review', 'Done', 'Cancelled']) {
        await expect(page.getByText(column, { exact: true }).first()).toBeVisible()
      }
      await expect(page.getByText('Board one')).toBeVisible()
      await expect(page.getByText('Board two')).toBeVisible()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('shows an empty state rather than a blank page', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      await page.goto(`/backend/tasks/projects/${project.id}?tab=list`)
      await expect(page.getByText(/no tasks yet/i)).toBeVisible()

      await page.goto(`/backend/tasks/projects/${project.id}?tab=docs`)
      await expect(page.getByText(/no documents yet/i)).toBeVisible()

      await page.goto(`/backend/tasks/projects/${project.id}?tab=milestones`)
      await expect(page.getByText(/no milestones yet/i)).toBeVisible()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('reaches every personal view from the module sidebar', async ({ page }) => {
    await page.goto('/backend/tasks/today')

    // The global backend sidebar links to these routes too; this test is about
    // the module's own nav, so scope every click to it.
    const moduleNav = page.getByRole('complementary', { name: 'Tasks navigation' })

    // The heading is not always the nav label ("Assigned to Me" vs "Assigned to
    // me"), and it has to be asserted by text: a client-side transition mounts
    // the outgoing and incoming page's h1 at the same time.
    for (const [label, path, heading] of [
      ['All Tasks', '/backend/tasks/all', 'All Tasks'],
      ['Upcoming', '/backend/tasks/upcoming', 'Upcoming'],
      ['Assigned to Me', '/backend/tasks/assigned', 'Assigned to me'],
      ['Completed', '/backend/tasks/completed', 'Completed'],
      ['Team', '/backend/tasks/team', 'Team'],
    ] as const) {
      await moduleNav.getByRole('link', { name: label, exact: true }).click()
      await page.waitForURL(new RegExp(path.replace(/\//g, '\\/')))
      await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
    }
  })
})
