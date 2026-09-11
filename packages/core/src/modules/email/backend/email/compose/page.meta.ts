export const metadata = {
  requireAuth: true,
  requireFeatures: ['email.templates.view'],
  pageTitle: 'Compose Email',
  pageTitleKey: 'email.nav.compose',
  pageGroup: 'Email',
  pageGroupKey: 'email.nav.group',
  pageOrder: 32,
  breadcrumb: [
    { label: 'Email Templates', labelKey: 'email.nav.templates', href: '/backend/email/templates' },
    { label: 'Compose Email', labelKey: 'email.nav.compose' },
  ],
} as const
