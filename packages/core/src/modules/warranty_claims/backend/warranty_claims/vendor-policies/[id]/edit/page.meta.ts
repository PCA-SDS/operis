export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.vendor_policy.manage'],
  pageTitle: 'Edit Vendor Policy',
  pageTitleKey: 'warranty_claims.vendorPolicies.edit.title',
  pageGroup: 'Warranty Claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Vendor Policies', labelKey: 'warranty_claims.vendorPolicies.nav.title', href: '/backend/warranty_claims/vendor-policies' },
    { label: 'Edit Vendor Policy', labelKey: 'warranty_claims.vendorPolicies.edit.title' },
  ],
}

export default metadata
