export const metadata = {
  requireAuth: true,
  requireFeatures: ['appointments.create'],
  pageTitle: 'Create appointment',
  pageTitleKey: 'appointments.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Appointments', labelKey: 'appointments.nav.list', href: '/backend/appointments' },
    { label: 'Create', labelKey: 'appointments.create.title' },
  ],
}
