import {
  filterKnownScopes,
  listMcpScopeValues,
  moduleIdsForScopes,
  registerMcpScope,
  resetMcpScopeRegistryForTests,
  scopesGrantMutations,
  toolNamesForScopes,
} from '../lib/scope-registry'

beforeEach(() => {
  resetMcpScopeRegistryForTests()
  registerMcpScope({
    scope: 'tasks:read',
    moduleId: 'tasks',
    description: 'Read tasks',
    tools: ['tasks_list', 'tasks_get'],
    loadTools: async () => [],
  })
  registerMcpScope({
    scope: 'tasks:write',
    moduleId: 'tasks',
    description: 'Write tasks',
    tools: ['tasks_list', 'tasks_get', 'tasks_create'],
    grantsMutations: true,
    loadTools: async () => [],
  })
})

describe('MCP scope registry', () => {
  it('drops scopes the deployment does not define', () => {
    expect(filterKnownScopes(['tasks:read', 'admin:*', 'sales:write'])).toEqual(['tasks:read'])
  })

  it('de-duplicates repeated scopes', () => {
    expect(filterKnownScopes(['tasks:read', 'tasks:read'])).toEqual(['tasks:read'])
  })

  it('resolves only the tools a scope names', () => {
    expect(toolNamesForScopes(['tasks:read'])).toEqual(new Set(['tasks_list', 'tasks_get']))
    expect(toolNamesForScopes(['tasks:write'])).toEqual(
      new Set(['tasks_list', 'tasks_get', 'tasks_create']),
    )
  })

  it('exposes nothing for an unknown scope', () => {
    expect(toolNamesForScopes(['catalog:read'])).toEqual(new Set())
    expect(moduleIdsForScopes(['catalog:read'])).toEqual([])
  })

  it('reports which scopes permit mutations', () => {
    expect(scopesGrantMutations(['tasks:read'])).toBe(false)
    expect(scopesGrantMutations(['tasks:read', 'tasks:write'])).toBe(true)
  })

  it('maps scopes to their owning module for entitlement checks', () => {
    expect(moduleIdsForScopes(['tasks:read', 'tasks:write'])).toEqual(['tasks'])
  })

  it('lists supported scope values for authorization-server metadata', () => {
    expect(listMcpScopeValues()).toEqual(['tasks:read', 'tasks:write'])
  })

  it('copies the tool list so a caller cannot mutate the registry', () => {
    const tools = ['tasks_list']
    registerMcpScope({
      scope: 'probe:read',
      moduleId: 'probe',
      description: 'probe',
      tools,
      loadTools: async () => [],
    })
    tools.push('evil_tool')
    expect(toolNamesForScopes(['probe:read'])).toEqual(new Set(['tasks_list']))
  })
})
