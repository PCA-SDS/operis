export const metadata = {
  requireAuth: true,
  requireFeatures: ['appointments.view'],
  pageTitle: 'Confirmed Calendar',
  pageTitleKey: 'appointments.overview.title',
  pageGroup: 'Appointments',
  pageGroupKey: 'appointments.nav.group',
  pagePriority: 10,
  pageOrder: 11,
  icon: 'calendar-days',
  breadcrumb: [
    { label: 'Appointments', labelKey: 'appointments.nav.list', href: '/backend/appointments' },
    { label: 'Confirmed Calendar', labelKey: 'appointments.overview.title' },
  ],
}
