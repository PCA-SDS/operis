export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.templates.manage'],
  pageTitle: 'Create Email Template',
  pageTitleKey: 'email.nav.createTemplate',
  pageGroup: 'Email',
  pageGroupKey: 'email.nav.group',
  pageOrder: 31,
  navHidden: true,
  breadcrumb: [
    { label: 'Email Templates', labelKey: 'email.nav.templates', href: '/backend/email/templates' },
    { label: 'Create', labelKey: 'email.nav.createTemplate' },
  ],
} as const
