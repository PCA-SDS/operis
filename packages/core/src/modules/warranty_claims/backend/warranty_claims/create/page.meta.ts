export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.claim.create'],
  pageTitle: 'New Claim',
  pageTitleKey: 'warranty_claims.create.title',
  pageGroup: 'Warranty Claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'New Claim', labelKey: 'warranty_claims.create.title' },
  ],
}
