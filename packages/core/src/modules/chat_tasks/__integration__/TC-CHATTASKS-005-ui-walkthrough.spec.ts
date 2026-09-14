import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  cleanupChatTasks,
  createColleague,
  openDirectConversation,
  sendMessage,
  type Colleague,
} from '@open-mercato/core/helpers/integration/chatTasksFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'tasks', 'chat_tasks'] }

const CREATOR = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign']

/**
 * The composer, once it is genuinely interactive.
 *
 * Present in the DOM is not the same as hydrated: the transcript, the membership query
 * and the injection registry all resolve after the first paint, and a keystroke sent
 * before React has attached its handlers is simply lost — the field stays empty and the
 * failure looks like "the menu never opened" rather than "the character never arrived".
 *
 * Typing a character and asserting it stuck is the only check that actually proves the
 * handler is live, so every test here goes through this.
 */
async function readyComposer(page: import('@playwright/test').Page) {
  const composer = page.getByRole('textbox', { name: 'Message' })
  await expect(composer).toBeVisible()
  // The send control renders with the field, so its presence means the form is mounted.
  await expect(page.getByRole('button', { name: 'Send' })).toBeAttached()
  await composer.click()
  await expect(async () => {
    // Cleared first. `pressSequentially` APPENDS, so without this a failed attempt leaves
    // a `/` behind and the next one types `//` — which can never satisfy the assertion,
    // turning one lost keystroke into the full retry budget spent on a value that is
    // drifting further from the target with every pass.
    await composer.fill('')
    await composer.pressSequentially('/')
    await expect(composer).toHaveValue('/', { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  return composer
}

/**
 * TC-CHATTASKS-005: the walkthrough a person actually performs.
 *
 * Open a conversation, type `/`, pick Create task, fill it in, submit — then find the
 * card in the transcript, the task in Tasks, and both still there after a reload. The
 * reload assertions are the point: a flow that only moved local React state would pass
 * every click and fail here.
 */
test.describe('TC-CHATTASKS-005: creating a task from the chat UI', () => {
  // A browser walkthrough of a two-module flow: sign in, load the shell, hydrate the
  // transcript, open a drawer and write through two modules. The suite default is sized
  // for an API call.
  test.setTimeout(60_000)

  /**
   * Pay the server's cold start here rather than inside a test's budget.
   *
   * The app is one long-lived process that loads a route's server modules, its DI
   * graph and its ORM metadata on that route's FIRST request. Whichever browser test
   * runs first absorbs that, and measured against a freshly started server it is the
   * difference between a 3-second walkthrough and one that exceeds sixty: every run
   * immediately after a restart failed here, and every run against a warm server
   * passed. Raising the timeout would have hidden that rather than moved it.
   *
   * Failures are swallowed on purpose — this is a warm-up, and anything genuinely
   * wrong with these routes is the assertion's business, not the hook's.
   */
  test.beforeAll(async ({ request }) => {
    await Promise.all([
      request.get('/backend/chat').catch(() => undefined),
      request.get('/backend/chat/workspace').catch(() => undefined),
      request.get('/login').catch(() => undefined),
    ])
  })

  test('types a slash command, creates a task, and finds the card after a reload', async ({
    page,
    request,
  }) => {
    /**
     * The longest walkthrough in the suite, and the only one that needs this.
     *
     * It signs in, loads the shell, hydrates a transcript, types a command one key at
     * a time, opens a drawer, writes through two modules, reloads the page and then
     * opens a side panel. On its own that is about three seconds; inside a full
     * 126-test run against a shared single-process app it has repeatedly needed more
     * than sixty, and every failure was a bare timeout — never an assertion.
     *
     * `test.slow()` triples the budget rather than weakening anything: same steps,
     * same assertions, more wall clock for the one test that genuinely needs it.
     */
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let bob: Colleague | null = null
    const taskIds: string[] = []
    const title = `Prepare the proposal ${Date.now()}`

    try {
      // The admin drives the browser, so the counterpart is the one created here.
      bob = await createColleague(request, adminToken, organizationId, 'ui-bob', CREATOR)
      const conversationId = await openDirectConversation({ request, token: adminToken }, bob.id)

      await login(page, 'admin')
      await page.goto(`/backend/chat/${conversationId}`)

      /**
       * 1. `/` opens the command menu.
       *
       * Typed rather than filled. The menu opens only while the caret is inside a leading
       * command token — the same rule chat's mention menu follows — and `fill` sets the
       * value programmatically without leaving the caret where typing would. That is not
       * a quirk to work around: a pasted block must not open a command menu, and this is
       * the behaviour that stops it.
       *
       * The commands themselves come from this module through chat's
       * `chat:composer:commands` spot, so their presence here also proves the injection
       * wiring resolved in a real browser rather than only in a unit test.
       */
      const composer = await readyComposer(page)
      const menu = page.getByRole('listbox', { name: /commands/i })
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('option', { name: /create task/i })).toBeVisible()

      // 2. Selecting it opens the composer drawer.
      await menu.getByRole('option', { name: /create task/i }).click()
      const drawer = page.getByRole('dialog')
      await expect(drawer).toBeVisible()
      await expect(drawer.getByText(/create task/i).first()).toBeVisible()

      // 3. The visibility notice is on screen before anything is typed. A person about
      //    to write confidential detail has to be told the task is not private.
      await expect(drawer.getByText(/not private to this conversation/i)).toBeVisible()

      // 4. The assignee defaults to the other person in the conversation.
      await expect(drawer.getByText(/QA ChatTasks ui-bob/)).toBeVisible()

      // 5. Fill it in and submit.
      await drawer.getByLabel(/^task$/i).fill(title)
      await drawer.getByRole('button', { name: /^create task$/i }).click()
      await expect(drawer).toBeHidden({ timeout: 15_000 })

      // 6. The card is in the transcript, and it shows the task.
      const card = page.locator('[data-chat-task-card="available"]')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText(title)).toBeVisible()
      await expect(card.getByRole('link', { name: /open task/i })).toBeVisible()

      // 7. The real task exists server-side, assigned to the counterpart.
      const listed = await apiRequest(
        request,
        'GET',
        `/api/tasks/my-tasks?view=all&pageSize=100&search=${encodeURIComponent(title)}`,
        { token: adminToken },
      )
      const match = ((await listed.json()).items as { id: string; title: string }[]).find(
        (item) => item.title === title,
      )
      expect(match, 'the task should exist server-side').toBeTruthy()
      if (match) taskIds.push(match.id)

      // 8. And it survives a reload — the card is a persisted row, not React state.
      await page.reload()
      const afterReload = page.locator('[data-chat-task-card="available"]')
      await expect(afterReload).toBeVisible({ timeout: 15_000 })
      await expect(afterReload.getByText(title)).toBeVisible()

      /**
       * 9. The conversation's Tasks panel lists it too.
       *
       * The toggle is scoped to the conversation header: the left sidebar also has a
       * "Tasks" group button, and an unscoped `getByRole('button', { name: /tasks/i })`
       * picks that one and expands the nav instead. The panel is then found by its own
       * marker rather than by role, because chat renders the region as an aside above the
       * split width and as a drawer below it — keying on either would assert the layout
       * rather than the contents.
       */
      await page.locator('header').getByRole('button', { name: 'Tasks' }).first().click()
      const panel = page.locator('[data-chat-tasks-panel]')
      await expect(panel).toBeVisible()
      await expect(panel.getByText(title)).toBeVisible({ timeout: 15_000 })
    } finally {
      await cleanupChatTasks({ request, token: adminToken }, { taskIds })
      if (bob) {
        await deleteUserIfExists(request, adminToken, bob.id)
        await deleteRoleIfExists(request, adminToken, bob.roleId)
      }
    }
  })

  test('the assignee sees the same card in their own session', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    /**
     * The seeded `employee`, not a fixture user.
     *
     * `login(page, role)` only knows the seeded credentials, and the employee role
     * already carries what this asserts — `setup.ts` grants it `chat.view`, `chat.send`,
     * `tasks.view`, `tasks.create`, `tasks.edit` and `tasks.assign`. Using it also makes
     * this a test of the shipped default grants rather than of a role invented here.
     */
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeId = getTokenScope(employeeToken).userId

    const taskIds: string[] = []
    const title = `Assigned to the employee ${Date.now()}`

    try {
      expect(employeeId, 'the employee token should carry a subject').toBeTruthy()
      const conversationId = await openDirectConversation({ request, token: adminToken }, employeeId)

      // Raised by the admin through the API, so this test is about what the ASSIGNEE
      // sees rather than about the create flow, which the first test already covers.
      const created = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        {
          token: adminToken,
          data: {
            idempotencyKey: `ui-peer-${Date.now()}`,
            title,
            tz: 'UTC',
            assigneeIds: [employeeId],
          },
        },
      )
      expect(created.ok()).toBeTruthy()
      taskIds.push((await created.json()).taskId)

      // The assignee's own browser session.
      await login(page, 'employee')
      await page.goto(`/backend/chat/${conversationId}`)

      /**
       * Wait for the conversation shell before looking for the card.
       *
       * The card is rendered by a widget that runs its own authorized read once the
       * transcript has mounted, so asserting on it straight after `goto` races the
       * hydration rather than the feature — the assertion's own timeout then has to
       * cover page load as well as the fetch, and under a full-suite run it
       * occasionally did not. The composer appearing is the same "this page is live"
       * signal `readyComposer` waits for, and it costs nothing when the page is quick.
       */
      await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()

      const card = page.locator('[data-chat-task-card="available"]')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText(title)).toBeVisible()

      // They may act on it, because the employee role holds `tasks.edit`.
      await expect(card.getByRole('button', { name: /^complete$/i })).toBeVisible()

      // And it is in their own workspace, because it is assigned to them.
      await page.goto('/backend/chat/workspace')
      /**
       * Scoped to `main`, which is the region a reader actually looks at.
       *
       * Not a softened assertion — it is the correct one. While the route streams in,
       * this page briefly carries a second copy of its body OUTSIDE `main`, for
       * something on the order of a hundred milliseconds; nobody sees it, but an
       * unscoped `getByText` sees two nodes and fails strict mode. Asserting against
       * the page region pins what is rendered to the user and is indifferent to the
       * transient.
       */
      const workspace = page.getByRole('main')
      await expect(workspace.getByRole('heading', { name: /my workspace/i })).toBeVisible()
      await expect(
        workspace.getByText(/this workspace is private, the tasks are not/i),
      ).toBeVisible()
      await expect(workspace.getByText(title)).toBeVisible({ timeout: 15_000 })
    } finally {
      await cleanupChatTasks({ request, token: adminToken }, { taskIds })
    }
  })

  /**
   * "Create task" in a message's overflow menu is asserted in the unit tests, not here.
   *
   * `RowActions` closes its portalled menu 150ms after the pointer leaves the trigger, so
   * driving it from a browser is a hit-test against a floating element that is trying to
   * dismiss itself — flaky in a way that says nothing about the feature. Chat's own suite
   * made the same call for its pin action (TC-CHAT-008) and for the same reason.
   *
   * What that test would have proved is covered better elsewhere:
   *   - the entry appears in the menu — `MessageList.injectedActions.test.tsx`
   *   - the composer copies nothing by default and reveals the text only on an explicit
   *     opt-in — `ChatTaskComposer.source.test.tsx`
   *   - nothing from the message reaches the stored task — TC-CHATTASKS-003, end to end
   *     against a real database.
   */

  test('an ordinary message that starts with a slash still sends', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let bob: Colleague | null = null

    try {
      bob = await createColleague(request, adminToken, organizationId, 'slash-bob', CREATOR)
      const conversationId = await openDirectConversation({ request, token: adminToken }, bob.id)

      await login(page, 'admin')
      await page.goto(`/backend/chat/${conversationId}`)

      // A path, not a command. This is the regression that matters most: the feature
      // must not swallow ordinary messages.
      const composer = await readyComposer(page)
      const line = `/etc/passwd is unreadable ${Date.now()}`
      await composer.fill(line)
      await composer.press('Enter')

      await expect(page.getByText(line)).toBeVisible({ timeout: 15_000 })
      // And no drawer opened.
      await expect(page.getByRole('dialog')).toBeHidden()
    } finally {
      if (bob) {
        await deleteUserIfExists(request, adminToken, bob.id)
        await deleteRoleIfExists(request, adminToken, bob.roleId)
      }
    }
  })
})
