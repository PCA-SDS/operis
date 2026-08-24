/**
 * OAuth scopes this module publishes to the MCP endpoint.
 *
 * Importing this file registers them; `di.ts` does that once at container setup.
 * Keeping the declaration here — rather than in the `mcp` module — is what lets
 * the MCP endpoint stay domain-agnostic: it knows about scopes and tools, never
 * about tasks.
 *
 * Scope ids are user-visible on the consent screen and are persisted inside
 * issued refresh tokens, so renaming one invalidates existing grants.
 */
import { registerMcpScope } from '../mcp/lib/scope-registry'

export const TASKS_READ_SCOPE = 'tasks:read'
export const TASKS_WRITE_SCOPE = 'tasks:write'

const READ_TOOLS = ['tasks_list_projects', 'tasks_list', 'tasks_search', 'tasks_get']
const WRITE_TOOLS = ['tasks_create', 'tasks_update', 'tasks_set_status']

const loadTasksAiTools = async (): Promise<unknown[]> => {
  const module = await import('./ai-tools')
  return module.aiTools ?? []
}

registerMcpScope({
  scope: TASKS_READ_SCOPE,
  moduleId: 'tasks',
  description: 'Read projects and tasks, including status, assignees and due dates.',
  tools: READ_TOOLS,
  loadTools: loadTasksAiTools,
})

registerMcpScope({
  scope: TASKS_WRITE_SCOPE,
  moduleId: 'tasks',
  description: 'Create tasks, update task fields and change task status.',
  // A write grant is useless without the reads that locate what to write to, so
  // `tasks:write` carries the read tools too. It stays a strict superset —
  // holding it never implies any capability outside this module.
  tools: [...READ_TOOLS, ...WRITE_TOOLS],
  grantsMutations: true,
  loadTools: loadTasksAiTools,
})
