export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.constraints.manage'],
  pageTitle: 'Constraints',
  pageTitleKey: 'catalog.constraints.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Products & Services', labelKey: 'catalog.products.page.title', href: '/backend/catalog/products' },
    { label: 'Constraints', labelKey: 'catalog.constraints.breadcrumb' },
  ],
}
