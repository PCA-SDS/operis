export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.accounting_defaults.manage'],
  pageTitle: 'Email Accounting Defaults',
  pageTitleKey: 'email.nav.accountingDefaults',
  pageGroup: 'Communication',
  pageGroupKey: 'email.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Email Templates', labelKey: 'email.nav.templates', href: '/backend/email/templates' },
    { label: 'Accounting Defaults', labelKey: 'email.nav.accountingDefaults' },
  ],
} as const
