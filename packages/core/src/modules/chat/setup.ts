import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Chat has no reference data to seed — a conversation only exists once two
 * people start one. All this module needs from setup is the ACL grants, so
 * everybody who can sign in can talk to their colleagues from day one.
 *
 * Every seeded tenant role is listed, not just the built-in three. `operator`
 * and `supervisor` are WMS's roles (`wms/lib/roleFeatures.ts`), named here as
 * plain strings rather than imported so chat still sets up when WMS is
 * disabled — `ensureDefaultRoleAcls` skips a role name it cannot find. Granting
 * chat to a warehouse role is the coordination that file asks for, not a reuse
 * of the role for another purpose: shop-floor staff are colleagues too.
 *
 * A role an administrator creates later is NOT covered — this list is seeded,
 * not reactive — so it needs `chat.view`/`chat.send` granted in the role editor.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['chat.*'],
    employee: ['chat.view', 'chat.send'],
    operator: ['chat.view', 'chat.send'],
    supervisor: ['chat.view', 'chat.send'],
  },
}

export default setup
