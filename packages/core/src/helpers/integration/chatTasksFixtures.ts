import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from './api'
import { createRoleFixture, createUserFixture, setRoleAclFeatures } from './authFixtures'

/**
 * Fixtures for the chat-to-tasks integration.
 *
 * Everything is created per run, so nothing here leans on seeded or demo data and two
 * workers can never collide. Chat has no fixture file of its own — conversations are
 * created through the same API a person uses — so the conversation helpers live here
 * beside the ones that need them.
 */

export type ChatTasksFixtureContext = {
  request: APIRequestContext
  token: string
}

/**
 * Satisfies the default password policy (`buildPasswordSchema`): length, a digit, an
 * uppercase letter and a symbol. `secret` is rejected with a 400.
 */
export const CHAT_TASKS_PASSWORD = 'Valid1!Pass'

export type Colleague = {
  id: string
  email: string
  token: string
  roleId: string
}

/**
 * A colleague with exactly the grants named, and nothing else.
 *
 * One role per person rather than a shared one, because most of these tests are about
 * what somebody cannot do — and a shared role would make every such test depend on the
 * order the others ran in.
 */
export async function createColleague(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  label: string,
  features: readonly string[],
): Promise<Colleague> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const roleId = await createRoleFixture(request, adminToken, { name: `QA ChatTasks ${label} ${suffix}` })
  await setRoleAclFeatures(request, adminToken, { roleId, features: [...features] })

  const email = `chat-tasks-${label}-${suffix}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: CHAT_TASKS_PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA ChatTasks ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, CHAT_TASKS_PASSWORD), roleId }
}

/** The one canonical direct conversation between the caller and `userId`. */
export async function openDirectConversation(
  ctx: ChatTasksFixtureContext,
  userId: string,
): Promise<string> {
  const response = await apiRequest(ctx.request, 'POST', '/api/chat/conversations', {
    token: ctx.token,
    data: { userId },
  })
  if (!response.ok()) {
    throw new Error(`[internal] Direct conversation fixture failed (${response.status()}): ${await response.text()}`)
  }
  return ((await response.json()) as { id: string }).id
}

export async function createSpace(
  ctx: ChatTasksFixtureContext,
  memberIds: readonly string[],
): Promise<string> {
  const response = await apiRequest(ctx.request, 'POST', '/api/chat/conversations', {
    token: ctx.token,
    data: {
      kind: 'space',
      title: `QA ChatTasks space ${Date.now()}`,
      // Omitted rather than sent empty: the schema treats an empty array as a
      // validation failure, and "just me for now" is a valid space.
      memberIds: memberIds.length > 0 ? [...memberIds] : undefined,
    },
  })
  if (!response.ok()) {
    throw new Error(`[internal] Space fixture failed (${response.status()}): ${await response.text()}`)
  }
  return ((await response.json()) as { id: string }).id
}

export async function sendMessage(
  ctx: ChatTasksFixtureContext,
  conversationId: string,
  body: string,
): Promise<string> {
  const response = await apiRequest(
    ctx.request,
    'POST',
    `/api/chat/conversations/${conversationId}/messages`,
    { token: ctx.token, data: { body, clientMessageId: `qa-${Date.now()}-${Math.random()}` } },
  )
  if (!response.ok()) {
    throw new Error(`[internal] Message fixture failed (${response.status()}): ${await response.text()}`)
  }
  return ((await response.json()) as { message: { id: string } }).message.id
}

/** A fresh idempotency key. One per intended task; reusing it is what a retry means. */
export function newIdempotencyKey(label = 'qa'): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export type CreatedChatTask = {
  taskId: string
  linkId: string
  cardPublished: boolean
  cardMessageId: string | null
  replayed: boolean
  task: { id: string; reference: string; title: string; status: string; updatedAt: string }
}

export async function createTaskFromConversation(
  ctx: ChatTasksFixtureContext,
  conversationId: string,
  body: Record<string, unknown>,
): Promise<CreatedChatTask> {
  const response = await apiRequest(
    ctx.request,
    'POST',
    `/api/chat_tasks/conversations/${conversationId}/tasks`,
    { token: ctx.token, data: { idempotencyKey: newIdempotencyKey(), ...body } },
  )
  if (!response.ok()) {
    throw new Error(`[internal] chat task fixture failed (${response.status()}): ${await response.text()}`)
  }
  return (await response.json()) as CreatedChatTask
}

/**
 * Tear down what a spec created, in dependency order, without failing the spec.
 *
 * Links first so a task delete cannot be the thing that removes them — proving the
 * two are separate operations is part of what these tests assert, so the teardown must
 * not rely on a cascade that is deliberately absent.
 */
export async function cleanupChatTasks(
  ctx: ChatTasksFixtureContext,
  ids: { linkIds?: string[]; taskIds?: string[]; projectIds?: string[] },
): Promise<void> {
  for (const linkId of ids.linkIds ?? []) {
    await apiRequest(ctx.request, 'DELETE', `/api/chat_tasks/links/${linkId}?removeCard=true`, {
      token: ctx.token,
    }).catch(() => undefined)
  }
  for (const taskId of ids.taskIds ?? []) {
    await apiRequest(ctx.request, 'DELETE', `/api/tasks/tasks/${taskId}`, { token: ctx.token }).catch(
      () => undefined,
    )
  }
  for (const projectId of ids.projectIds ?? []) {
    await apiRequest(ctx.request, 'DELETE', `/api/tasks/projects/${projectId}`, {
      token: ctx.token,
    }).catch(() => undefined)
  }
}
