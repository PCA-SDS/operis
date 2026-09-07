import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * Without this file the generated backend manifest carries `undefined` metadata
 * for the route, and `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`
 * gates its whole auth + module-entitlement + feature block on `requireAuth`,
 * so the page renders for anonymous visitors.
 */
export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['resources.areas.manage'],
  pageTitle: 'Edit Resource Area',
  pageTitleKey: 'resources.resourceAreas.form.editTitle',
  pageGroup: 'Resource Planning',
  pageGroupKey: 'resources.nav.group',
  breadcrumb: [
    { label: 'Resource Areas', labelKey: 'resources.resourceAreas.page.title', href: '/backend/resources/areas' },
    { label: 'Edit Resource Area', labelKey: 'resources.resourceAreas.form.editTitle' },
  ],
}

export default metadata
