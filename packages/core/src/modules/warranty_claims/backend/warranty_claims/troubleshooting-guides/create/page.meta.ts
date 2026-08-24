export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.troubleshooting.manage'],
  pageTitle: 'New Troubleshooting Guide',
  pageTitleKey: 'warranty_claims.troubleshootingGuides.create.title',
  pageGroup: 'Warranty Claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Troubleshooting Guides', labelKey: 'warranty_claims.troubleshootingGuides.nav.title', href: '/backend/warranty_claims/troubleshooting-guides' },
    { label: 'New Troubleshooting Guide', labelKey: 'warranty_claims.troubleshootingGuides.create.title' },
  ],
}

export default metadata
