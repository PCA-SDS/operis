export const metadata = {
  requireAuth: true,
  requireFeatures: ['appointments.view'],
  pageTitle: 'Appointment',
  pageTitleKey: 'appointments.detail.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Appointments', labelKey: 'appointments.nav.list', href: '/backend/appointments' },
    { label: 'Detail', labelKey: 'appointments.detail.title' },
  ],
}
