import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['resources.area_types.manage'],
  pageTitle: 'Add Area Type',
  pageTitleKey: 'resources.areaTypes.create.page.title',
  pageGroup: 'Resource Planning',
  pageGroupKey: 'resources.nav.group',
  breadcrumb: [
    { label: 'Area Types', labelKey: 'resources.areaTypes.nav.label', href: '/backend/resources/area-types' },
    { label: 'Add Area Type', labelKey: 'resources.areaTypes.create.page.title' },
  ],
}
