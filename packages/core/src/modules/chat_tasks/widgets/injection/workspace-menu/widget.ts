import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'
import { CHAT_TASKS_WORKSPACE_HREF } from '../../../lib/routes'

/**
 * "My workspace" in the sidebar, beneath chat's own Conversations entry.
 *
 * A menu item rather than a page with `pageGroup`, so it joins chat's existing group
 * instead of creating a second Chat heading — and so removing this module removes the
 * entry with it rather than leaving a link to a page that is gone.
 *
 * Two details decide whether it actually joins that group, and getting either wrong
 * renders a second "Chat" heading at the bottom of the sidebar:
 *
 *  - `groupId` must be the id `buildAdminNav` derives for a page-based entry, which is
 *    its `pageGroupKey` (`chat.nav.group`) and not the group's display name.
 *  - there must be **no** `placement`. `mergeMenuItems` only takes the join-an-existing-
 *    group branch when a `placement` is absent; declaring one sends the item down the
 *    relative-placement path instead, which matches on menu-item ids — and a page-derived
 *    entry like Conversations has none to match, so the item falls through to its own
 *    group. Without a placement the item is appended after the group's last entry, which
 *    is where it belongs anyway.
 */
const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'chat_tasks.injection.workspace-menu',
    title: 'My workspace link',
    // The page itself declares the same two, and the server enforces them. This is
    // what keeps the entry from appearing for somebody who would only meet a 403.
    features: ['chat.view', 'tasks.view'],
    requiredModules: ['chat', 'tasks'],
    priority: 90,
  },
  menuItems: [
    {
      id: 'chat-tasks-workspace',
      label: 'My workspace',
      labelKey: 'chat_tasks.workspace.title',
      href: CHAT_TASKS_WORKSPACE_HREF,
      icon: 'square-check-big',
      groupId: 'chat.nav.group',
      groupLabel: 'Chat',
      groupLabelKey: 'chat.nav.group',
    },
  ],
}

export default widget
