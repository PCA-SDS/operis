export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.registration.manage'],
  pageTitle: 'Edit Registration',
  pageTitleKey: 'warranty_claims.registrations.edit.title',
  pageGroup: 'Warranty Claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Registrations', labelKey: 'warranty_claims.registrations.nav.title', href: '/backend/warranty_claims/registrations' },
    { label: 'Edit Registration', labelKey: 'warranty_claims.registrations.edit.title' },
  ],
}
