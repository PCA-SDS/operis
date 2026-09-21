export const metadata = {
  requireAuth: true,
  /**
   * `chat.view` and `tasks.view`.
   *
   * The page lives in chat's URL space and shows tasks, so both reads are needed to
   * make sense of it — but notably NOT `chat.send`: this surface is not a
   * conversation and writes to none.
   */
  requireFeatures: ['chat.view', 'tasks.view'],
  pageTitle: 'My workspace',
  pageTitleKey: 'chat_tasks.workspace.title',
  // Reached from chat's own navigation rather than listed as a second Chat entry in
  // the sidebar: it is a surface inside chat, not a peer of it.
  navHidden: true,
  breadcrumb: [
    { label: 'Chat', labelKey: 'chat.nav.title', href: '/backend/chat' },
    { label: 'My workspace', labelKey: 'chat_tasks.workspace.title' },
  ],
}
