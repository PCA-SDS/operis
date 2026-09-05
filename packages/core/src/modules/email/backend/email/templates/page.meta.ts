export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.templates.view'],
  pageTitle: 'Email Templates',
  pageTitleKey: 'email.nav.templates',
  pageGroup: 'Communication',
  pageGroupKey: 'email.nav.group',
  breadcrumb: [{ label: 'Email Templates', labelKey: 'email.nav.templates' }],
} as const
