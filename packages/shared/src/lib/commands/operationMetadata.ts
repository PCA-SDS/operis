export type OperationMetadataPayload = {
  id: string
  undoToken: string
  commandId: string
  actionLabel: string | null
  resourceKind: string | null
  resourceId: string | null
  executedAt: string
}

export const OPERATION_METADATA_HEADER_NAME = 'x-om-operation'

export type OperationLogEntryLike = {
  id?: string | null
  undoToken?: string | null
  commandId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  createdAt?: Date | string | null
}

export type OperationMetadataFallback = {
  resourceKind?: string | null
  resourceId?: string | null
}

const HEADER_PREFIX = 'omop:'

export function serializeOperationMetadata(payload: OperationMetadataPayload): string {
  const encoded = encodeURIComponent(JSON.stringify(payload))
  return `${HEADER_PREFIX}${encoded}`
}

export function deserializeOperationMetadata(value: string | null | undefined): OperationMetadataPayload | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.startsWith(HEADER_PREFIX) ? value.slice(HEADER_PREFIX.length) : value
  try {
    const parsed = JSON.parse(decodeURIComponent(trimmed))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.id !== 'string' || typeof parsed.commandId !== 'string') return null
    if (typeof parsed.undoToken !== 'string' || !parsed.undoToken) return null
    if (typeof parsed.executedAt !== 'string') return null
    return {
      id: parsed.id,
      undoToken: parsed.undoToken,
      commandId: parsed.commandId,
      actionLabel: parsed.actionLabel ?? null,
      resourceKind: parsed.resourceKind ?? null,
      resourceId: parsed.resourceId ?? null,
      executedAt: parsed.executedAt,
    }
  } catch {
    return null
  }
}

function resolveExecutedAt(createdAt: OperationLogEntryLike['createdAt']): string {
  if (createdAt instanceof Date) return createdAt.toISOString()
  if (typeof createdAt === 'string' && createdAt.trim().length > 0) return createdAt
  return new Date().toISOString()
}

/**
 * Sets the undo header on `response` when the command wrote an undoable log
 * entry, and returns the response. The entry's own resource wins over the
 * fallback. Headers that cannot be modified are left as they are.
 */
export function attachOperationMetadataHeader<T extends Response>(
  response: T,
  logEntry: OperationLogEntryLike | null | undefined,
  fallback: OperationMetadataFallback = {},
): T {
  if (!logEntry?.undoToken || !logEntry.id || !logEntry.commandId) return response
  const headerValue = serializeOperationMetadata({
    id: logEntry.id,
    undoToken: logEntry.undoToken,
    commandId: logEntry.commandId,
    actionLabel: logEntry.actionLabel ?? null,
    resourceKind: logEntry.resourceKind ?? fallback.resourceKind ?? null,
    resourceId: logEntry.resourceId ?? fallback.resourceId ?? null,
    executedAt: resolveExecutedAt(logEntry.createdAt),
  })
  try {
    response.headers.set(OPERATION_METADATA_HEADER_NAME, headerValue)
  } catch {
    // immutable headers (e.g. a redirect response) keep their original set
  }
  return response
}
