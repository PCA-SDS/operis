export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.submissions.manage'],
  pageTitle: 'Create Evidence Submission',
  pageTitleKey: 'eudr.evidenceSubmissions.create.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Evidence Submissions', labelKey: 'eudr.nav.submissions', href: '/backend/eudr/evidence-submissions' },
    { label: 'Create', labelKey: 'eudr.evidenceSubmissions.create.title' },
  ],
}
