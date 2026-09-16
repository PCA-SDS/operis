export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.accounting_defaults.manage'],
  pageTitle: 'Accounting Defaults',
  pageTitleKey: 'email.nav.accountingDefaults',
  pageGroup: 'Email',
  pageGroupKey: 'email.nav.group',
  pageOrder: 33,
  navHidden: true,
  breadcrumb: [
    { label: 'Email Templates', labelKey: 'email.nav.templates', href: '/backend/email/templates' },
    { label: 'Accounting Defaults', labelKey: 'email.nav.accountingDefaults' },
  ],
} as const
