export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.templates.view'],
  pageTitle: 'Compose Email Preview',
  pageTitleKey: 'email.nav.compose',
  pageGroup: 'Communication',
  pageGroupKey: 'email.nav.group',
  breadcrumb: [
    { label: 'Email Templates', labelKey: 'email.nav.templates', href: '/backend/email/templates' },
    { label: 'Compose Preview', labelKey: 'email.nav.compose' },
  ],
} as const
