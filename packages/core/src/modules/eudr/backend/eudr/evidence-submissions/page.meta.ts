export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.submissions.view'],
  pageTitle: 'Evidence Submissions',
  pageTitleKey: 'eudr.nav.submissions',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  pagePriority: 10,
  pageOrder: 20,
  icon: 'files',
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Evidence Submissions', labelKey: 'eudr.nav.submissions' },
  ],
}
