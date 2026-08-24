/**
 * The allowlist that makes this a *narrow* MCP server.
 *
 * A tool is reachable over MCP only when some registered scope names it. The
 * global AI tool registry contains far more than that — Code Mode's sandboxed
 * `api.request()` among them — and none of it is exposed unless it appears here.
 *
 * Modules register their own scopes (see `tasks/mcp-scopes.ts`), so the MCP
 * module never needs to know what a task is.
 */
export type McpScopeDefinition = {
  /** OAuth scope value, e.g. `tasks:read`. */
  scope: string
  /** Module that owns the tools — used for entitlement gating. */
  moduleId: string
  /** Shown on the consent screen and in authorization-server metadata. */
  description: string
  /** Exact tool names this scope unlocks. No wildcards, by design. */
  tools: string[]
  /** True when the scope permits writes; used for mutation rate limiting. */
  grantsMutations?: boolean
  /**
   * Loads the owning module's `ai-tools.ts` definitions.
   *
   * The MCP endpoint deliberately does NOT call `loadAllModuleTools()`, which
   * would also register Code Mode's sandboxed `api.request()` tools and hand an
   * MCP client the whole OpenAPI surface. Each scope brings only its own module's
   * tools, and only the names listed above are ever exposed.
   */
  loadTools: () => Promise<unknown[]>
}

const registry = new Map<string, McpScopeDefinition>()

export function registerMcpScope(definition: McpScopeDefinition): void {
  if (!definition?.scope) throw new Error('[internal] MCP scope must define a scope value')
  if (!definition.moduleId) throw new Error('[internal] MCP scope must define a moduleId')
  registry.set(definition.scope, {
    ...definition,
    tools: [...definition.tools],
    grantsMutations: definition.grantsMutations ?? false,
  })
}

export function getMcpScope(scope: string): McpScopeDefinition | undefined {
  return registry.get(scope)
}

export function listMcpScopes(): McpScopeDefinition[] {
  return Array.from(registry.values())
}

export function listMcpScopeValues(): string[] {
  return Array.from(registry.keys()).sort((left, right) => left.localeCompare(right))
}

/** Drops anything the deployment does not define — unknown scopes never widen access. */
export function filterKnownScopes(requested: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const scope of requested) {
    if (!registry.has(scope) || seen.has(scope)) continue
    seen.add(scope)
    result.push(scope)
  }
  return result
}

/** Tool names unlocked by the granted scopes. */
export function toolNamesForScopes(scopes: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const scope of scopes) {
    const definition = registry.get(scope)
    if (!definition) continue
    for (const tool of definition.tools) names.add(tool)
  }
  return names
}

/** Module ids touched by the granted scopes, for entitlement checks. */
export function moduleIdsForScopes(scopes: readonly string[]): string[] {
  const modules = new Set<string>()
  for (const scope of scopes) {
    const definition = registry.get(scope)
    if (definition) modules.add(definition.moduleId)
  }
  return Array.from(modules)
}

export function scopesGrantMutations(scopes: readonly string[]): boolean {
  return scopes.some((scope) => registry.get(scope)?.grantsMutations === true)
}

/** @__internal Test-only hook — reset the process-wide scope registry. */
export function resetMcpScopeRegistryForTests(): void {
  registry.clear()
}
