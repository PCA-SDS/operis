export const metadata = {
  requireAuth: true,
  // Creating the conversation is the point of this route, so it needs the write
  // feature rather than `chat.view`.
  requireFeatures: ['chat.send'],
  navHidden: true,
  pageTitle: 'Chat',
  pageTitleKey: 'chat.nav.title',
  breadcrumb: [{ label: 'Chat', labelKey: 'chat.nav.title', href: '/backend/chat' }],
}
