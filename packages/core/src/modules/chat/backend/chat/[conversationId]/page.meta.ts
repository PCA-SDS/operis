export const metadata = {
  requireAuth: true,
  requireFeatures: ['chat.view'],
  // The list route owns the nav entry; a conversation is reached from it, not
  // from the sidebar.
  navHidden: true,
  pageTitle: 'Chat',
  pageTitleKey: 'chat.nav.title',
  breadcrumb: [{ label: 'Chat', labelKey: 'chat.nav.title', href: '/backend/chat' }],
}
