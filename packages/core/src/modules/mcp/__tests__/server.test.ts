/**
 * Tool discovery and dispatch.
 *
 * `tools/list` must show only what the caller may actually run, and `tools/call`
 * must refuse anything the OAuth scope or the user's ERP permissions do not
 * cover — including tools that exist but were never published to MCP.
 */
import { z } from 'zod'
import {
  registerMcpScope,
  resetMcpScopeRegistryForTests,
} from '../lib/scope-registry'
import { resetMcpScopedToolsForTests } from '../lib/tool-loading'
import { resolveAccessibleTools, toolAnnotations } from '../lib/server'
import type { McpAuthenticatedContext } from '../lib/resource-auth'

const readTool = {
  name: 'tasks_list',
  description: 'List tasks',
  inputSchema: z.object({}),
  requiredFeatures: ['tasks.view'],
  handler: jest.fn().mockResolvedValue({ items: [] }),
}

const writeTool = {
  name: 'tasks_create',
  description: 'Create a task',
  inputSchema: z.object({ title: z.string() }),
  requiredFeatures: ['tasks.create'],
  isMutation: true,
  handler: jest.fn().mockResolvedValue({ id: 'task-1' }),
}

/** Stands in for a tool that exists in the process but is NOT published to MCP. */
const unpublishedTool = {
  name: 'codemode_execute',
  description: 'Run arbitrary API calls',
  inputSchema: z.object({}),
  requiredFeatures: [],
  handler: jest.fn(),
}

function context(overrides: Partial<McpAuthenticatedContext> = {}): McpAuthenticatedContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    tokenId: 'jti-1',
    scopes: ['tasks:read'],
    grantedFeatures: ['tasks.view', 'tasks.create'],
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetMcpScopeRegistryForTests()
  resetMcpScopedToolsForTests()

  const loadTools = async () => [readTool, writeTool, unpublishedTool]

  registerMcpScope({
    scope: 'tasks:read',
    moduleId: 'tasks',
    description: 'Read tasks',
    tools: ['tasks_list'],
    loadTools,
  })
  registerMcpScope({
    scope: 'tasks:write',
    moduleId: 'tasks',
    description: 'Write tasks',
    tools: ['tasks_list', 'tasks_create'],
    grantsMutations: true,
    loadTools,
  })
})

describe('accessible tool resolution', () => {
  it('exposes only read tools for a read-only token', async () => {
    const tools = await resolveAccessibleTools(context({ scopes: ['tasks:read'] }))
    expect([...tools.keys()]).toEqual(['tasks_list'])
  })

  it('exposes read and write tools for a read+write token', async () => {
    const tools = await resolveAccessibleTools(context({ scopes: ['tasks:read', 'tasks:write'] }))
    expect([...tools.keys()].sort()).toEqual(['tasks_create', 'tasks_list'])
  })

  it('never exposes a tool no scope publishes, even with a matching grant', async () => {
    // codemode_execute requires no features and is loaded alongside the task
    // tools; only the scope allowlist keeps it out.
    const tools = await resolveAccessibleTools(
      context({ scopes: ['tasks:read', 'tasks:write'], grantedFeatures: ['*'] }),
    )
    expect(tools.has('codemode_execute')).toBe(false)
  })

  it('hides a tool whose required feature the user does not hold', async () => {
    const tools = await resolveAccessibleTools(
      context({ scopes: ['tasks:read', 'tasks:write'], grantedFeatures: ['tasks.view'] }),
    )
    // OAuth grants tasks:write, but the ERP does not grant tasks.create.
    expect([...tools.keys()]).toEqual(['tasks_list'])
  })

  it('hides everything when the user holds no grants', async () => {
    const tools = await resolveAccessibleTools(
      context({ scopes: ['tasks:read', 'tasks:write'], grantedFeatures: [] }),
    )
    expect(tools.size).toBe(0)
  })

  it('honours a wildcard grant for the owning module only', async () => {
    const tools = await resolveAccessibleTools(
      context({ scopes: ['tasks:read', 'tasks:write'], grantedFeatures: ['tasks.*'] }),
    )
    expect([...tools.keys()].sort()).toEqual(['tasks_create', 'tasks_list'])
  })

  it('does not treat the session as super admin', async () => {
    // An empty grant list must not be rescued by any implicit bypass.
    const tools = await resolveAccessibleTools(
      context({ scopes: ['tasks:read'], grantedFeatures: [] }),
    )
    expect(tools.size).toBe(0)
  })
})


describe('tool annotations advertised to the client', () => {
  it('marks a read tool read-only and non-destructive', () => {
    expect(toolAnnotations(readTool as never)).toEqual({
      title: 'tasks_list',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
  })

  it('marks a mutation as not read-only, so ChatGPT asks before writing', () => {
    const annotations = toolAnnotations(writeTool as never)
    expect(annotations.readOnlyHint).toBe(false)
    expect(annotations.idempotentHint).toBe(false)
    expect(annotations.openWorldHint).toBe(false)
  })

  it('reports the safe upper bound when destructiveness is a predicate', () => {
    // A predicate cannot be evaluated at discovery time, so a mutation must be
    // advertised as potentially destructive rather than assumed safe.
    const predicateTool = { ...writeTool, isDestructive: () => false }
    expect(toolAnnotations(predicateTool as never).destructiveHint).toBe(true)
  })

  it('never advertises a mutation as read-only', () => {
    for (const tool of [writeTool, { ...writeTool, isDestructive: true }]) {
      expect(toolAnnotations(tool as never).readOnlyHint).toBe(false)
    }
  })
})
