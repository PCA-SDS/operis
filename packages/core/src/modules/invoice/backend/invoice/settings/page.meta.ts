export const metadata = {
  requireAuth: true,
  requireFeatures: ['invoice.settings.manage'],
  pageTitle: 'Invoice settings',
  pageTitleKey: 'invoice.settings.title',
  pageGroup: 'Invoice',
  pageGroupKey: 'invoice.nav.group',
  pageOrder: 35,
  icon: 'settings',
  breadcrumb: [
    { label: 'Invoice', labelKey: 'invoice.nav.title' },
    { label: 'Invoice settings', labelKey: 'invoice.settings.title' },
  ],
}
