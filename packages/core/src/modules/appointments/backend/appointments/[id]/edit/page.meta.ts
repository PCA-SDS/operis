export const metadata = {
  requireAuth: true,
  requireFeatures: ['appointments.manage'],
  pageTitle: 'Edit Appointment',
  pageTitleKey: 'appointments.edit.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Appointments', labelKey: 'appointments.nav.list', href: '/backend/appointments' },
    { label: 'Edit', labelKey: 'appointments.edit.title' },
  ],
}
