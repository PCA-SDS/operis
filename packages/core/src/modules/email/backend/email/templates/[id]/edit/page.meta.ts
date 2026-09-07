export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.templates.manage'],
  pageTitle: 'Edit Email Template',
  pageTitleKey: 'email.nav.editTemplate',
  pageGroup: 'Communication',
  pageGroupKey: 'email.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Email Templates', labelKey: 'email.nav.templates', href: '/backend/email/templates' },
    { label: 'Edit', labelKey: 'email.nav.editTemplate' },
  ],
} as const
