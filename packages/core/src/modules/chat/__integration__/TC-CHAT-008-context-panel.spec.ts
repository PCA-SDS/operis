import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

export const integrationMeta = { dependsOnModules: ['chat'] }

/**
 * TC-CHAT-008: the conversation's contextual side panel.
 *
 * The unit tests pin the width arithmetic and the component's own behaviour.
 * What they cannot reach is the part that depends on the router: switching
 * conversations remounts the chat shell, and the panel only survives that
 * because its open state is held outside React. That is a question about Next,
 * not about React, so it is asked here in a real browser (§18).
 *
 * Five fuller cases rather than one per assertion, deliberately. Signing in
 * costs an attempt against a limit of five per minute per email, and each case
 * needs both an API token and a browser session — so a case per assertion put
 * enough sign-ins through in a few seconds that later ones were refused, the
 * page loaded with no session, and every test failed on a timeout that had
 * nothing to do with what it was checking. Fewer cases stay under that ceiling
 * and make each page load earn more than one assertion.
 */

const PANEL = 'aside[aria-label="Pinned messages"]'
const SHARED = 'aside[aria-label="Shared"]'

async function createSpaceWithPin(request: APIRequestContext, token: string, title: string) {
  const conversation = await apiRequest(request, 'POST', '/api/chat/conversations', {
    token,
    data: { kind: 'space', title },
  })
  const created = await conversation.json()
  const conversationId = created?.item?.id ?? created?.id
  expect(conversationId, `space "${title}" should have been created`).toBeTruthy()

  const message = await apiRequest(
    request,
    'POST',
    `/api/chat/conversations/${conversationId}/messages`,
    { token, data: { body: `pinned marker for ${title}` } },
  )
  const sent = await message.json()
  const messageId = sent?.item?.id ?? sent?.message?.id ?? sent?.id
  expect(messageId, 'message should have been created').toBeTruthy()

  const pin = await apiRequest(
    request,
    'POST',
    `/api/chat/conversations/${conversationId}/messages/${messageId}/pin`,
    { token },
  )
  // Asserted rather than assumed: the header control that opens the region is
  // hidden at zero pins, so a silently failed pin looks exactly like a missing
  // button and sends whoever reads the failure chasing the wrong defect.
  expect(pin.ok(), 'message should have been pinned').toBe(true)
  return conversationId as string
}

/** The region only splits when the container can afford both panes. */
async function useWideViewport(page: Page) {
  await page.setViewportSize({ width: 1800, height: 1000 })
}

function openPins(page: Page) {
  return page.getByRole('button', { name: /pinned messages/i }).click()
}

test.describe('TC-CHAT-008: contextual side panel', () => {
  test('opens beside the transcript, resizes, and switches tools in place', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const conversationId = await createSpaceWithPin(request, token, `Panel W ${Date.now()}`)

    await useWideViewport(page)
    await login(page, 'admin')
    await page.goto(`/backend/chat/${conversationId}`)

    const transcript = page.getByRole('region', { name: 'Messages' })
    const before = (await transcript.boundingBox())?.width ?? 0

    await openPins(page)
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()

    // A real column, not a cover: the transcript gives up room (§3), and a
    // dialog would mean the conversation is obscured instead.
    expect((await transcript.boundingBox())?.width ?? 0).toBeLessThan(before)
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)

    // Every control in the header is one height, so their hover targets do not
    // read as different sizes sitting side by side.
    const headerHeights = await page.evaluate(() => {
      const labels = ['Search this conversation', 'Shared files and links', 'View pinned messages']
      return labels.map((label) => {
        const el = Array.from(document.querySelectorAll('button')).find(
          (b) =>
            b.getAttribute('aria-label') === label ||
            b.getAttribute('title') === label ||
            b.textContent?.includes(label),
        )
        return el ? Math.round(el.getBoundingClientRect().height) : -1
      })
    })
    expect(headerHeights).not.toContain(-1)
    expect(new Set(headerHeights).size, `header heights differ: ${headerHeights}`).toBe(1)

    // The divider answers the keyboard, and stops at its limit rather than
    // eating the transcript (§5, §33).
    const separator = page.getByRole('separator', { name: /resize panel/i })
    await separator.focus()
    const start = Number(await separator.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowLeft')
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(start)
    for (let press = 0; press < 40; press += 1) await page.keyboard.press('ArrowLeft')
    const widened = Number(await separator.getAttribute('aria-valuenow'))
    expect(widened).toBe(Number(await separator.getAttribute('aria-valuemax')))

    // The other tool reuses the same region at the same width (§47, §48).
    await page.getByRole('button', { name: /shared files and links/i }).click()
    const shared = page.locator(SHARED)
    await expect(shared).toBeVisible()
    await expect(page.locator(PANEL)).toHaveCount(0)
    expect(Math.round((await shared.boundingBox())?.width ?? 0)).toBe(widened)

    // None of it produces a horizontal scrollbar (§12).
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0)
  })

  test('stays open and re-points when the conversation changes', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const firstTitle = `Panel A ${Date.now()}`
    const secondTitle = `Panel B ${Date.now()}`
    const first = await createSpaceWithPin(request, token, firstTitle)
    const second = await createSpaceWithPin(request, token, secondTitle)

    await useWideViewport(page)
    await login(page, 'admin')
    await page.goto(`/backend/chat/${first}`)

    await openPins(page)
    await expect(page.locator(PANEL)).toBeVisible()

    // A link click, NOT `page.goto`: a full document load resets React state by
    // definition, so navigating that way would prove nothing about whether the
    // region survives a switch. Clicking the rail is what a reader does.
    await page.getByRole('link', { name: new RegExp(secondTitle) }).click()
    await expect(page).toHaveURL(new RegExp(second))

    await expect(page.locator(PANEL)).toBeVisible()
    await expect(page.locator(PANEL)).toContainText(`pinned marker for ${secondTitle}`, {
      timeout: 10_000,
    })
    await expect(page.locator(PANEL)).not.toContainText(firstTitle)
  })

  test('falls back to an overlay when the container cannot hold both', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const conversationId = await createSpaceWithPin(request, token, `Panel N ${Date.now()}`)

    await page.setViewportSize({ width: 700, height: 900 })
    await login(page, 'admin')
    await page.goto(`/backend/chat/${conversationId}`)

    await openPins(page)

    // Two unusable columns would be worse than one usable one (§10, §55), and
    // precision dragging is not offered where there is nothing to drag (§50).
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.locator(PANEL)).toHaveCount(0)
    await expect(page.getByRole('separator', { name: /resize panel/i })).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0)
  })

  test('unpins from the panel and drops the row', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const title = `Panel U ${Date.now()}`
    const conversationId = await createSpaceWithPin(request, token, title)

    await useWideViewport(page)
    await login(page, 'admin')
    await page.goto(`/backend/chat/${conversationId}`)
    await openPins(page)

    const panel = page.locator(PANEL)
    await expect(panel).toContainText(`pinned marker for ${title}`)

    // The control is in the panel, it actually unpins (§30), and the list
    // reflects it without a manual refresh (§31).
    await panel.getByRole('button', { name: /unpin message/i }).first().click()
    await expect(panel).not.toContainText(`pinned marker for ${title}`, { timeout: 10_000 })
  })

  test('splits on a 1280 laptop by standing the conversation rail down', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const conversationId = await createSpaceWithPin(request, token, `Panel L ${Date.now()}`)

    // The size of a standard laptop, and the one this layout used to give up on:
    // the rail took enough of it that a transcript and a panel could not both
    // fit, so pins covered the conversation instead of sitting beside it.
    await page.setViewportSize({ width: 1280, height: 900 })
    await login(page, 'admin')
    await page.goto(`/backend/chat/${conversationId}`)

    const rail = page.getByRole('complementary', { name: 'Chat' })
    await expect(rail).toBeVisible()

    await openPins(page)

    // Beside the conversation, not over it.
    await expect(page.locator(PANEL)).toBeVisible()
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)

    // The width came from the rail, which stands down while the region is open.
    await expect(rail).toBeHidden()

    // And the transcript that bought is genuinely readable, not a sliver.
    const transcript = page.getByRole('region', { name: 'Messages' })
    expect((await transcript.boundingBox())?.width ?? 0).toBeGreaterThan(500)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0)

    // Closing the region gives the rail back.
    await page.getByRole('button', { name: 'Close panel' }).click()
    await expect(rail).toBeVisible()
  })
})
