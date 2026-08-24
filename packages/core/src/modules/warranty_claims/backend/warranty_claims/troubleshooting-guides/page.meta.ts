export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.troubleshooting.manage'],
  pageTitle: 'Troubleshooting Guides',
  pageTitleKey: 'warranty_claims.troubleshootingGuides.nav.title',
  pageGroup: 'Warranty Claims',
  pageGroupKey: 'warranty_claims.nav.group',
  pagePriority: 40,
  pageOrder: 400,
  icon: 'help-circle',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Troubleshooting Guides', labelKey: 'warranty_claims.troubleshootingGuides.nav.title' },
  ],
}

export default metadata
