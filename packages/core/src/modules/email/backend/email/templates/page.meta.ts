export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.templates.view'],
  pageTitle: 'Email Templates',
  pageTitleKey: 'email.nav.templates',
  pageGroup: 'Email',
  pageGroupKey: 'email.nav.group',
  pageOrder: 30,
  breadcrumb: [{ label: 'Email Templates', labelKey: 'email.nav.templates' }],
} as const
