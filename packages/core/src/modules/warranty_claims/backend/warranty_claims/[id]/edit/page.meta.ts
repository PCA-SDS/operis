export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.claim.manage'],
  pageTitle: 'Edit Claim',
  pageTitleKey: 'warranty_claims.edit.title',
  pageGroup: 'Warranty Claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Edit Claim', labelKey: 'warranty_claims.edit.title' },
  ],
}
