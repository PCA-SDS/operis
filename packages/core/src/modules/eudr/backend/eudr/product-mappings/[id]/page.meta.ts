export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.mappings.manage'],
  pageTitle: 'Edit Product Mapping',
  pageTitleKey: 'eudr.productMappings.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Product Mappings', labelKey: 'eudr.nav.mappings', href: '/backend/eudr/product-mappings' },
    { label: 'Edit Product Mapping', labelKey: 'eudr.productMappings.edit.title' },
  ],
}
