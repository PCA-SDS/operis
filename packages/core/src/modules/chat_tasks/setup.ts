import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Nothing to seed, and no features of its own.
 *
 * Deliberate: this module introduces **no ACL feature**. Every gate it applies is
 * one of chat's two or one of the tasks module's fourteen, asked of the same RBAC
 * service those modules ask. A `chat_tasks.view` would be a third thing to grant
 * and a third thing to forget, and — worse — a surface an operator could widen
 * without realising it widened access to tasks or to conversations.
 *
 * The on/off switch is module entitlement (`tenant_modules`), which is the right
 * granularity: an organization either connects the two products or it does not.
 */
export const setup: ModuleSetupConfig = {}

export default setup
