export const metadata = {
  requireAuth: true,
  requireFeatures: ['chat.accounts.connect_own'],
  pageTitle: 'My WhatsApp',
  pageTitleKey: 'chat.personal.title',
  pageGroup: 'Profile',
  pageGroupKey: 'chat.personal.profileGroup',
  pageOrder: 40,
  icon: 'smartphone',
  pageContext: 'profile' as const,
  breadcrumb: [
    { label: 'Profile', labelKey: 'chat.personal.profileGroup' },
    { label: 'My WhatsApp', labelKey: 'chat.personal.title' },
  ],
} as const
