import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Who may connect an MCP client.
 *
 * `mcp.connect` gates the consent screen only — it is permission to *start* a
 * connection, never permission to read or write anything. What a connection can
 * actually do is decided by the user's own module features on every call, so
 * granting this to employees does not widen their reach.
 *
 * Client registration stays with administrators.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['mcp.*'],
    employee: ['mcp.connect'],
  },
}

export default setup
