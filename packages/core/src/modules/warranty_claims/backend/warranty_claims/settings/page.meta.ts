export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.settings.manage'],
  pageTitle: 'Warranty Claim Settings',
  pageTitleKey: 'warranty_claims.settings.pageTitle',
  pageGroup: 'Warranty Claims',
  pageGroupKey: 'warranty_claims.nav.group',
  pagePriority: 40,
  pageOrder: 900,
  icon: 'settings',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Warranty Claim Settings', labelKey: 'warranty_claims.settings.pageTitle' },
  ],
}
