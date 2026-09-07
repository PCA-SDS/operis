export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.products.manage'],
  pageTitle: 'Option Tree',
  pageTitleKey: 'catalog.options.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Products & Services', labelKey: 'catalog.products.page.title', href: '/backend/catalog/products' },
    { label: 'Options', labelKey: 'catalog.options.breadcrumb' },
  ],
}
