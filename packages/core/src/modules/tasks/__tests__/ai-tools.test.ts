/**
 * The Tasks tool surface.
 *
 * These are contract tests for what the MCP endpoint publishes: which tools
 * exist, what they are allowed to touch, and — most importantly — what their
 * input schemas refuse to accept.
 */
import { aiTools } from '../ai-tools'
import { TASKS_READ_SCOPE, TASKS_WRITE_SCOPE } from '../mcp-scopes'
import { getMcpScope } from '../../mcp/lib/scope-registry'

type Tool = (typeof aiTools)[number]

const byName = new Map(aiTools.map((tool) => [tool.name, tool]))

function schemaOf(tool: Tool) {
  return tool.inputSchema as { safeParse: (input: unknown) => { success: boolean; data?: unknown } }
}

describe('tasks tool surface', () => {
  it('publishes exactly the intended tools', () => {
    expect([...byName.keys()].sort()).toEqual([
      'tasks_create',
      'tasks_get',
      'tasks_list',
      'tasks_list_projects',
      'tasks_search',
      'tasks_set_status',
      'tasks_update',
    ])
  })

  it('exposes no destructive operation', () => {
    // Task deletion is deliberately absent from the MCP surface.
    for (const name of byName.keys()) {
      expect(name).not.toMatch(/delete|destroy|purge|remove/i)
    }
  })

  it('marks exactly the write tools as mutations', () => {
    const mutations = aiTools.filter((tool) => tool.isMutation === true).map((tool) => tool.name)
    expect(mutations.sort()).toEqual(['tasks_create', 'tasks_set_status', 'tasks_update'])
  })

  it('gives every tool a description and a required feature', () => {
    for (const tool of aiTools) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      // Only tasks features — a task tool must never require reach elsewhere.
      for (const feature of tool.requiredFeatures ?? []) {
        expect(feature.startsWith('tasks.')).toBe(true)
      }
    }
  })

  it('requires write features on write tools and read features on read tools', () => {
    expect(byName.get('tasks_create')?.requiredFeatures).toEqual(['tasks.create'])
    expect(byName.get('tasks_update')?.requiredFeatures).toEqual(['tasks.edit'])
    expect(byName.get('tasks_set_status')?.requiredFeatures).toEqual(['tasks.edit'])
    expect(byName.get('tasks_get')?.requiredFeatures).toEqual(['tasks.view'])
    expect(byName.get('tasks_list')?.requiredFeatures).toEqual(['tasks.view'])
  })
})

describe('tool input schemas reject scope smuggling', () => {
  /**
   * The single most important property in this file. If any tool accepted a
   * tenant or organization id, an MCP client could aim it at another tenant —
   * so the schemas must strip or reject those keys outright.
   */
  it.each([...byName.keys()])('%s ignores tenant/organization/user arguments', (name) => {
    const tool = byName.get(name) as Tool
    const base: Record<string, unknown> = {
      taskId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      title: 'Probe',
      status: 'todo',
      query: 'probe',
    }
    const hostile = {
      ...base,
      tenantId: '99999999-9999-4999-8999-999999999999',
      organizationId: '88888888-8888-4888-8888-888888888888',
      userId: '77777777-7777-4777-8777-777777777777',
      isSuperAdmin: true,
    }

    const parsed = schemaOf(tool).safeParse(hostile)
    if (!parsed.success) return
    const data = parsed.data as Record<string, unknown>
    expect(data.tenantId).toBeUndefined()
    expect(data.organizationId).toBeUndefined()
    expect(data.userId).toBeUndefined()
    expect(data.isSuperAdmin).toBeUndefined()
  })

  it('rejects a non-UUID task id', () => {
    const parsed = schemaOf(byName.get('tasks_get') as Tool).safeParse({ taskId: '../../etc/passwd' })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown status value', () => {
    const parsed = schemaOf(byName.get('tasks_set_status') as Tool).safeParse({
      taskId: '11111111-1111-4111-8111-111111111111',
      status: 'DROP TABLE tasks_tasks',
    })
    expect(parsed.success).toBe(false)
  })

  it('bounds page size so a client cannot request an unbounded read', () => {
    const schema = schemaOf(byName.get('tasks_list') as Tool)
    expect(schema.safeParse({ pageSize: 100 }).success).toBe(true)
    expect(schema.safeParse({ pageSize: 5000 }).success).toBe(false)
    expect(schema.safeParse({ pageSize: 0 }).success).toBe(false)
  })

  it('bounds title length on create', () => {
    const schema = schemaOf(byName.get('tasks_create') as Tool)
    const projectId = '22222222-2222-4222-8222-222222222222'
    expect(schema.safeParse({ projectId, title: 'ok' }).success).toBe(true)
    expect(schema.safeParse({ projectId, title: 'x'.repeat(301) }).success).toBe(false)
    expect(schema.safeParse({ projectId, title: '' }).success).toBe(false)
  })

  it('bounds search terms', () => {
    const schema = schemaOf(byName.get('tasks_search') as Tool)
    expect(schema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false)
    expect(schema.safeParse({ query: 'find me' }).success).toBe(true)
  })

  it('accepts a weekly recurrence with a weekday', () => {
    const schema = schemaOf(byName.get('tasks_create') as Tool)
    const parsed = schema.safeParse({
      projectId: '22222222-2222-4222-8222-222222222222',
      title: 'Weekly report review',
      recurrence: { freq: 'weekly', weekday: 1 },
      dueTime: '09:00',
      timeZone: 'Asia/Singapore',
    })
    expect(parsed.success).toBe(true)
    expect((parsed.data as Record<string, unknown>).recurrence).toEqual({ freq: 'weekly', weekday: 1 })
  })

  it('accepts every frequency the Task domain defines, and nothing else', () => {
    const schema = schemaOf(byName.get('tasks_create') as Tool)
    const base = { projectId: '22222222-2222-4222-8222-222222222222', title: 'x' }
    for (const freq of ['daily', 'weekdays', 'weekly', 'monthly']) {
      expect(schema.safeParse({ ...base, recurrence: { freq } }).success).toBe(true)
    }
    // No second recurrence vocabulary: anything the domain cannot store is refused.
    expect(schema.safeParse({ ...base, recurrence: { freq: 'yearly' } }).success).toBe(false)
    expect(schema.safeParse({ ...base, recurrence: { freq: 'every-2-weeks' } }).success).toBe(false)
  })

  it('bounds weekday and dayOfMonth to the domain ranges', () => {
    const schema = schemaOf(byName.get('tasks_create') as Tool)
    const base = { projectId: '22222222-2222-4222-8222-222222222222', title: 'x' }
    expect(schema.safeParse({ ...base, recurrence: { freq: 'weekly', weekday: 7 } }).success).toBe(false)
    expect(schema.safeParse({ ...base, recurrence: { freq: 'weekly', weekday: -1 } }).success).toBe(false)
    expect(schema.safeParse({ ...base, recurrence: { freq: 'monthly', dayOfMonth: 0 } }).success).toBe(false)
    expect(schema.safeParse({ ...base, recurrence: { freq: 'monthly', dayOfMonth: 32 } }).success).toBe(false)
    expect(schema.safeParse({ ...base, recurrence: { freq: 'monthly', dayOfMonth: 31 } }).success).toBe(true)
  })

  it('lets an update stop a task repeating', () => {
    const schema = schemaOf(byName.get('tasks_update') as Tool)
    const parsed = schema.safeParse({
      taskId: '11111111-1111-4111-8111-111111111111',
      recurrence: null,
    })
    expect(parsed.success).toBe(true)
    expect((parsed.data as Record<string, unknown>).recurrence).toBeNull()
  })

  it('rejects a malformed due time', () => {
    const schema = schemaOf(byName.get('tasks_create') as Tool)
    const base = { projectId: '22222222-2222-4222-8222-222222222222', title: 'x' }
    expect(schema.safeParse({ ...base, dueTime: '9am' }).success).toBe(false)
    expect(schema.safeParse({ ...base, dueTime: '25:00' }).success).toBe(false)
    expect(schema.safeParse({ ...base, dueTime: '09:00' }).success).toBe(true)
  })

  it('caps assignee and label collections', () => {
    const schema = schemaOf(byName.get('tasks_create') as Tool)
    const uuids = Array.from({ length: 21 }, (_, index) =>
      `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    )
    expect(
      schema.safeParse({
        projectId: '22222222-2222-4222-8222-222222222222',
        title: 'ok',
        assigneeIds: uuids,
      }).success,
    ).toBe(false)
  })
})

// Importing `../mcp-scopes` at the top of this file is what registers the scopes;
// they are a module-load side effect, so there is nothing to arrange here.
describe('published MCP scopes', () => {
  it('maps the read scope to read tools only', () => {
    const scope = getMcpScope(TASKS_READ_SCOPE)
    expect(scope?.moduleId).toBe('tasks')
    expect(scope?.grantsMutations).toBe(false)
    expect(scope?.tools.sort()).toEqual(['tasks_get', 'tasks_list', 'tasks_list_projects', 'tasks_search'])
  })

  it('maps the write scope to reads plus writes, and nothing else', () => {
    const scope = getMcpScope(TASKS_WRITE_SCOPE)
    expect(scope?.grantsMutations).toBe(true)
    expect(scope?.tools.sort()).toEqual([
      'tasks_create',
      'tasks_get',
      'tasks_list',
      'tasks_list_projects',
      'tasks_search',
      'tasks_set_status',
      'tasks_update',
    ])
  })

  it('publishes every scope tool as a real tool definition', () => {
    for (const scopeId of [TASKS_READ_SCOPE, TASKS_WRITE_SCOPE]) {
      for (const toolName of getMcpScope(scopeId)?.tools ?? []) {
        expect(byName.has(toolName)).toBe(true)
      }
    }
  })
})
