export const metadata = {
  requireAuth: true,
  requireFeatures: ['chat.view'],
  // Reached from the chat rail, not from the sidebar — the same relationship a
  // conversation has to the list.
  navHidden: true,
  pageTitle: 'Search chats',
  pageTitleKey: 'chat.search.allChats',
  breadcrumb: [{ label: 'Chat', labelKey: 'chat.nav.title', href: '/backend/chat' }],
}
