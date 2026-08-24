export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.products.view'],
  pageTitle: 'Product Details',
  pageTitleKey: 'catalog.products.detail.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Products & Services', labelKey: 'catalog.products.page.title', href: '/backend/catalog/products' },
  ],
}
