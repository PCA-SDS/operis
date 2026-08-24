export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.mappings.manage'],
  pageTitle: 'Create Product Mapping',
  pageTitleKey: 'eudr.productMappings.create.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Product Mappings', labelKey: 'eudr.nav.mappings', href: '/backend/eudr/product-mappings' },
    { label: 'Create', labelKey: 'eudr.productMappings.create.title' },
  ],
}
