import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import type { McpAuthenticatedContext } from './resource-auth'

const logger = createLogger('mcp').child({ component: 'audit' })

export type McpToolAuditEntry = {
  toolName: string
  /** Task (or other domain record) the call touched, when one is identifiable. */
  resourceId: string | null
  outcome: 'success' | 'denied' | 'error'
  /** Coarse reason for a non-success outcome. Never carries user input verbatim. */
  reason?: string
  correlationId: string
  isMutation: boolean
  durationMs: number
}

/**
 * Write the MCP call to the platform's existing access log rather than a parallel
 * logging channel. Mutations additionally leave an action-log entry, because they
 * run through the command bus exactly as a UI write does — this record is the
 * "who reached in over MCP" half that the command bus cannot see.
 *
 * Nothing token-shaped is ever recorded: no access or refresh token, no
 * authorization code, no client secret, no Authorization header. The token is
 * identified only by its `jti`.
 */
export async function recordMcpToolCall(
  container: AwilixContainer,
  context: McpAuthenticatedContext,
  entry: McpToolAuditEntry,
): Promise<void> {
  const auditContext = {
    surface: 'mcp',
    toolName: entry.toolName,
    clientId: context.clientId,
    tokenId: context.tokenId,
    scopes: context.scopes,
    outcome: entry.outcome,
    isMutation: entry.isMutation,
    correlationId: entry.correlationId,
    durationMs: entry.durationMs,
    ...(entry.reason ? { reason: entry.reason } : {}),
  }

  try {
    const accessLogs = container.resolve<AccessLogService>('accessLogService')
    await accessLogs.log({
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      resourceKind: 'mcp.tool_call',
      resourceId: entry.resourceId ?? entry.toolName,
      accessType: entry.isMutation ? 'write' : 'read',
      context: auditContext,
    })
  } catch (error) {
    // Auditing must never take the request down, but a failure to audit is
    // itself worth surfacing.
    logger.error('Failed to write MCP access log entry', { err: error, toolName: entry.toolName })
  }

  logger.info('MCP tool call', {
    ...auditContext,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    userId: context.userId,
    resourceId: entry.resourceId,
  })
}

/**
 * Authentication-stage audit. Deliberately separate: at this point there is no
 * verified identity to attribute the event to, so only the coarse reason and the
 * client-supplied (unverified) client id are recorded.
 */
export function recordMcpAuthFailure(input: {
  reason: string
  clientId?: string | null
  correlationId: string
}): void {
  logger.warn('MCP authentication failed', {
    surface: 'mcp',
    reason: input.reason,
    clientId: input.clientId ?? null,
    correlationId: input.correlationId,
  })
}
