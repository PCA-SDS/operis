import crypto from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import type {
  AiToolDefinition,
  McpToolContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { toolInputJsonSchema } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-input-schema'
import { recordMcpToolCall } from './audit'
import { enforceMcpRateLimit } from './rate-limit'
import { loadMcpScopedTools } from './tool-loading'
import { scopesGrantMutations, toolNamesForScopes } from './scope-registry'
import type { McpAuthenticatedContext } from './resource-auth'

const logger = createLogger('mcp').child({ component: 'server' })

export const MCP_SERVER_NAME = 'open-mercato-tasks'
export const MCP_SERVER_VERSION = '1.0.0'

/** Coarse, client-safe failure shapes. Internals never cross this boundary. */
type ToolFailure =
  | 'unknown_tool'
  | 'insufficient_scope'
  | 'insufficient_permission'
  | 'rate_limited'
  | 'validation_error'
  | 'not_found'
  | 'conflict'
  | 'server_error'

const FAILURE_MESSAGES: Record<ToolFailure, string> = {
  unknown_tool: 'Unknown tool.',
  insufficient_scope: 'The access token does not grant the scope required by this tool.',
  insufficient_permission: 'Your Open Mercato account is not permitted to perform this operation.',
  rate_limited: 'Too many requests. Please retry shortly.',
  validation_error: 'The tool arguments failed validation.',
  not_found: 'The requested record does not exist or is not visible to you.',
  conflict: 'The record changed since it was read. Re-read it and retry.',
  server_error: 'The operation could not be completed.',
}

function toolIsMutation(tool: AiToolDefinition): boolean {
  return tool.isMutation === true
}

/**
 * MCP tool annotations, derived from metadata the tool already declares.
 *
 * ChatGPT reads these to decide its confirmation and safety behaviour — a tool
 * without `readOnlyHint: false` may not be recognised as modifying external
 * data, so a write could run without the confirmation the operator expects.
 * They are a hint to the client, never a substitute for the server-side scope,
 * RBAC and tenant checks below.
 */
export function toolAnnotations(tool: AiToolDefinition): Record<string, unknown> {
  const mutation = toolIsMutation(tool)
  // A predicate-based `isDestructive` cannot be evaluated without arguments, so
  // discovery reports the safe upper bound: any mutation may be destructive.
  const destructive =
    typeof tool.isDestructive === 'function' ? mutation : tool.isDestructive === true

  return {
    title: tool.displayName ?? tool.name,
    readOnlyHint: !mutation,
    destructiveHint: destructive,
    idempotentHint: !mutation,
    // Everything reachable here is this tenant's own task data, not the open web.
    openWorldHint: false,
  }
}

/**
 * Tools this caller may both *see* and *run*.
 *
 * Two independent gates, and a tool must clear both:
 *   1. the OAuth scopes on the token name it, and
 *   2. the user's live Open Mercato grants cover its `requiredFeatures`.
 *
 * Because `grantedFeatures` comes from `getGrantedFeatures`, a disabled or
 * withheld module yields an empty list and the tool disappears from discovery
 * rather than failing at call time.
 */
export async function resolveAccessibleTools(
  context: McpAuthenticatedContext,
): Promise<Map<string, AiToolDefinition>> {
  const allTools = await loadMcpScopedTools()
  const scopedNames = toolNamesForScopes(context.scopes)
  const accessible = new Map<string, AiToolDefinition>()

  for (const [name, tool] of allTools) {
    if (!scopedNames.has(name)) continue
    const permitted = authorizeFeatures(tool.requiredFeatures ?? [], {
      grantedFeatures: context.grantedFeatures,
      // Never `true`: an MCP session must not inherit a super-admin bypass.
      unrestricted: false,
    })
    if (!permitted) continue
    accessible.set(name, tool)
  }

  return accessible
}

/**
 * Map a thrown domain error onto a coarse client-facing failure.
 *
 * Deliberately lossy. A 404 and a 403 both become `not_found` for record-shaped
 * errors so the endpoint cannot be used to probe which task ids exist in another
 * tenant — the difference between "absent" and "forbidden" is exactly the
 * enumeration oracle we must not provide.
 */
function classifyError(error: unknown): ToolFailure {
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  if (lowered.includes('validation') || lowered.includes('invalid input')) return 'validation_error'
  if (lowered.includes('not found') || lowered.includes('forbidden') || lowered.includes('unauthorized')) {
    return 'not_found'
  }
  if (lowered.includes('conflict') || lowered.includes('changed since')) return 'conflict'
  return 'server_error'
}

function failureResult(failure: ToolFailure) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: failure, message: FAILURE_MESSAGES[failure] }) }],
    isError: true,
  }
}

/** Best-effort record id for the audit trail; never fails the call. */
function extractResourceId(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const record = args as Record<string, unknown>
  const candidate = record.taskId ?? record.id ?? record.projectId
  return typeof candidate === 'string' ? candidate : null
}

export type ScopedMcpServerOptions = {
  container: AwilixContainer
  context: McpAuthenticatedContext
}

/**
 * Build an MCP server bound to one authenticated OAuth session.
 *
 * The server holds no ambient authority: every handler closes over the
 * already-validated `context`, and no request field can widen it.
 */
export async function createScopedMcpServer(options: ScopedMcpServerOptions): Promise<Server> {
  const { container, context } = options

  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const accessible = await resolveAccessibleTools(context)
    return {
      tools: Array.from(accessible.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toolInputJsonSchema(tool.inputSchema),
        annotations: toolAnnotations(tool),
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const startedAt = Date.now()
    const correlationId = crypto.randomUUID()
    const toolName = request.params.name
    const args = request.params.arguments ?? {}

    const accessible = await resolveAccessibleTools(context)
    const tool = accessible.get(toolName)

    if (!tool) {
      // Distinguish "no such tool" from "not allowed" only in the audit log.
      const allTools = await loadMcpScopedTools()
      const exists = allTools.has(toolName)
      const failure: ToolFailure = exists ? 'insufficient_permission' : 'unknown_tool'
      await recordMcpToolCall(container, context, {
        toolName,
        resourceId: null,
        outcome: 'denied',
        reason: failure,
        correlationId,
        isMutation: false,
        durationMs: Date.now() - startedAt,
      })
      return failureResult(failure)
    }

    const isMutation = toolIsMutation(tool)

    // A read scope must never reach a write tool, even if the tool's features
    // happen to be granted.
    if (isMutation && !scopesGrantMutations(context.scopes)) {
      await recordMcpToolCall(container, context, {
        toolName,
        resourceId: extractResourceId(args),
        outcome: 'denied',
        reason: 'insufficient_scope',
        correlationId,
        isMutation,
        durationMs: Date.now() - startedAt,
      })
      return failureResult('insufficient_scope')
    }

    const sessionLimited = await enforceMcpRateLimit('session', context.tokenId)
    if (sessionLimited) {
      await recordMcpToolCall(container, context, {
        toolName,
        resourceId: null,
        outcome: 'denied',
        reason: 'rate_limited',
        correlationId,
        isMutation,
        durationMs: Date.now() - startedAt,
      })
      return failureResult('rate_limited')
    }

    if (isMutation) {
      const mutationLimited = await enforceMcpRateLimit('mutation', `${context.tokenId}:mutation`)
      if (mutationLimited) {
        await recordMcpToolCall(container, context, {
          toolName,
          resourceId: extractResourceId(args),
          outcome: 'denied',
          reason: 'rate_limited',
          correlationId,
          isMutation,
          durationMs: Date.now() - startedAt,
        })
        return failureResult('rate_limited')
      }
    }

    // Tenant, organization and user come from the validated session — never from
    // tool arguments, which is why no tool schema accepts them.
    const toolContext: McpToolContext = {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.userId,
      container,
      userFeatures: context.grantedFeatures,
      isSuperAdmin: false,
      tool,
    }

    const parsed = tool.inputSchema.safeParse(args)
    if (!parsed.success) {
      await recordMcpToolCall(container, context, {
        toolName,
        resourceId: extractResourceId(args),
        outcome: 'denied',
        reason: 'validation_error',
        correlationId,
        isMutation,
        durationMs: Date.now() - startedAt,
      })
      const issues = (parsed.error as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues ?? []
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'validation_error',
              message: FAILURE_MESSAGES.validation_error,
              // Field-level issues are safe and genuinely useful to the client;
              // they describe the caller's own input, not server state.
              issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
            }),
          },
        ],
        isError: true,
      }
    }

    try {
      const result = await tool.handler(parsed.data, toolContext)
      await recordMcpToolCall(container, context, {
        toolName,
        resourceId: extractResourceId(args),
        outcome: 'success',
        correlationId,
        isMutation,
        durationMs: Date.now() - startedAt,
      })
      return {
        // Both shapes on purpose: `structuredContent` is what a model inspects
        // directly, while the JSON text block keeps clients that only read
        // `content` working. Same payload, so the two cannot disagree.
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        ...(result && typeof result === 'object' && !Array.isArray(result)
          ? { structuredContent: result as Record<string, unknown> }
          : {}),
      }
    } catch (error) {
      const failure = classifyError(error)
      // The full error goes to the server log; the client gets the coarse shape.
      logger.error('MCP tool execution failed', {
        toolName,
        correlationId,
        failure,
        err: error,
      })
      await recordMcpToolCall(container, context, {
        toolName,
        resourceId: extractResourceId(args),
        outcome: 'error',
        reason: failure,
        correlationId,
        isMutation,
        durationMs: Date.now() - startedAt,
      })
      return failureResult(failure)
    }
  })

  return server
}
