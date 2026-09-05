import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['resources.area_types.manage'],
  pageTitle: 'Area Types',
  pageTitleKey: 'resources.areaTypes.page.title',
  pageGroup: 'Resource Planning',
  pageGroupKey: 'resources.nav.group',
  pageOrder: 31,
  icon: 'layers',
  nav: {
    label: 'Area Types',
    labelKey: 'resources.areaTypes.nav.label',
    group: 'main',
    order: 31,
  },
  breadcrumb: [
    { label: 'Area Types', labelKey: 'resources.areaTypes.page.title' },
  ],
}
