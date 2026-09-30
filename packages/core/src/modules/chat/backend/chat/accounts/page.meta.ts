export const metadata = {
  requireAuth: true,
  requireFeatures: ['chat.accounts.manage'],
  pageTitle: 'WhatsApp',
  pageTitleKey: 'chat.accounts.title',
  pageGroup: 'Chat',
  pageGroupKey: 'chat.nav.group',
  pageOrder: 20,
  icon: 'smartphone',
  breadcrumb: [
    { label: 'Conversations', labelKey: 'chat.nav.conversations', href: '/backend/chat' },
    { label: 'WhatsApp', labelKey: 'chat.accounts.title' },
  ],
}
