import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from './api'

/**
 * Fixtures for the tasks module.
 *
 * Every helper creates what it needs and hands back an id, and `cleanupTasks`
 * tears the whole graph down in dependency order. Nothing here reads seeded or
 * demo data — a tasks test must pass against an empty tenant.
 */

export type TasksFixtureContext = {
  request: APIRequestContext
  token: string
}

export type CreatedProject = {
  id: string
  key: string
  name: string
  updatedAt: string
}

export type CreatedTask = {
  id: string
  number: number
  projectId: string
  projectKey: string
  updatedAt: string
}

/**
 * A project key that cannot collide — with a parallel worker, with a sibling
 * created in the same millisecond, or with a previous run of this same suite.
 *
 * The clock alone is not enough on any of those counts. `Date.now() % 100000`
 * repeats every 100 seconds, and two projects created back to back in one test
 * land on the same millisecond often enough to matter; either way the second
 * create fails with "a project with the key X already exists", which reads like a
 * product bug and is not one. A random suffix removes all three cases.
 *
 * Shaped for `PROJECT_KEY_REGEX` (`^[A-Z][A-Z0-9]{1,9}$`): a leading alphabetic
 * prefix, then base-36 characters, capped at the 10-character limit.
 */
export function uniqueProjectKey(prefix = 'QA'): string {
  const time = Date.now().toString(36).slice(-4)
  const random = Math.random().toString(36).slice(2, 6)
  return `${prefix}${time}${random}`.slice(0, 10).toUpperCase()
}

export async function createProject(
  ctx: TasksFixtureContext,
  overrides: Record<string, unknown> = {},
): Promise<CreatedProject> {
  const key = (overrides.key as string) ?? uniqueProjectKey()
  const response = await apiRequest(ctx.request, 'POST', '/api/tasks/projects', {
    token: ctx.token,
    data: { key, name: `QA Project ${key}`, ...overrides },
  })
  if (!response.ok()) {
    throw new Error(`[internal] Project fixture failed (${response.status()}): ${await response.text()}`)
  }
  const body = (await response.json()) as CreatedProject
  return body
}

export async function createTask(
  ctx: TasksFixtureContext,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<CreatedTask> {
  const response = await apiRequest(ctx.request, 'POST', `/api/tasks/projects/${projectId}/tasks`, {
    token: ctx.token,
    data: { title: `QA Task ${Date.now()}`, ...overrides },
  })
  if (!response.ok()) {
    throw new Error(`[internal] Task fixture failed (${response.status()}): ${await response.text()}`)
  }
  return (await response.json()) as CreatedTask
}

export async function createLabel(
  ctx: TasksFixtureContext,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string; updatedAt: string }> {
  const response = await apiRequest(ctx.request, 'POST', '/api/tasks/labels', {
    token: ctx.token,
    data: { name: `QA Label ${Date.now()}`, color: '#3F7BC0', ...overrides },
  })
  if (!response.ok()) {
    throw new Error(`[internal] Label fixture failed (${response.status()}): ${await response.text()}`)
  }
  return (await response.json()) as { id: string; name: string; updatedAt: string }
}

export async function createMilestone(
  ctx: TasksFixtureContext,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string; updatedAt: string }> {
  const response = await apiRequest(ctx.request, 'POST', `/api/tasks/projects/${projectId}/milestones`, {
    token: ctx.token,
    data: { name: `QA Milestone ${Date.now()}`, ...overrides },
  })
  if (!response.ok()) {
    throw new Error(`[internal] Milestone fixture failed (${response.status()}): ${await response.text()}`)
  }
  return (await response.json()) as { id: string; name: string; updatedAt: string }
}

/** Delete every fixture this test made. Deleting a project takes its tasks,
 *  milestones and pages with it, so projects go last. */
export async function cleanupTasks(
  ctx: TasksFixtureContext,
  ids: { projectIds?: string[]; labelIds?: string[] },
): Promise<void> {
  for (const labelId of ids.labelIds ?? []) {
    await apiRequest(ctx.request, 'DELETE', `/api/tasks/labels/${labelId}`, { token: ctx.token }).catch(
      () => {},
    )
  }
  for (const projectId of ids.projectIds ?? []) {
    await apiRequest(ctx.request, 'DELETE', `/api/tasks/projects/${projectId}`, {
      token: ctx.token,
    }).catch(() => {})
  }
}
