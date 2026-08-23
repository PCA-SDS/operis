export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.tenants.view'],
  pageTitle: 'Tenant Modules',
  pageTitleKey: 'directory.tenantModules.title',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Tenants', labelKey: 'directory.nav.tenants', href: '/backend/directory/tenants' },
    { label: 'Modules', labelKey: 'directory.tenantModules.breadcrumb' },
  ],
}
