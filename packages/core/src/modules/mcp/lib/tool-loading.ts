import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { listMcpScopes, toolNamesForScopes } from './scope-registry'

const logger = createLogger('mcp').child({ component: 'tool-loading' })

let cache: Promise<Map<string, AiToolDefinition>> | null = null

function isToolDefinition(value: unknown): value is AiToolDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    candidate.inputSchema !== undefined &&
    typeof candidate.handler === 'function'
  )
}

/**
 * Build the complete set of MCP-reachable tools.
 *
 * This is the boundary that makes the endpoint narrow. Only tools whose names
 * are explicitly listed by a registered scope survive; every other tool in the
 * process — including Code Mode's `execute`/`search` pair — is dropped even if
 * some other subsystem has registered it globally.
 */
async function loadScopedToolsUncached(): Promise<Map<string, AiToolDefinition>> {
  const tools = new Map<string, AiToolDefinition>()
  const scopes = listMcpScopes()
  const permittedNames = toolNamesForScopes(scopes.map((scope) => scope.scope))

  for (const scope of scopes) {
    let loaded: unknown[]
    try {
      loaded = await scope.loadTools()
    } catch (error) {
      logger.error('Failed to load tools for MCP scope', { scope: scope.scope, err: error })
      continue
    }

    for (const candidate of loaded) {
      if (!isToolDefinition(candidate)) continue
      if (!permittedNames.has(candidate.name)) continue
      tools.set(candidate.name, candidate)
    }
  }

  const missing = Array.from(permittedNames).filter((name) => !tools.has(name))
  if (missing.length > 0) {
    // A scope naming a tool that no module actually exports is a wiring bug; log
    // it loudly rather than silently serving a smaller tool list.
    logger.error('MCP scopes reference tools that were not loaded', { missing })
  }

  return tools
}

export function loadMcpScopedTools(): Promise<Map<string, AiToolDefinition>> {
  if (!cache) {
    cache = loadScopedToolsUncached().catch((error) => {
      cache = null
      throw error
    })
  }
  return cache
}

/** @__internal Test-only hook — reset the memoized tool map. */
export function resetMcpScopedToolsForTests(): void {
  cache = null
}
