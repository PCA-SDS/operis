export const metadata = {
  requireAuth: true,
  requireFeatures: ['devices.admin'],
  pageTitle: 'Edit Device',
  pageTitleKey: 'devices.form.editTitle',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Devices', labelKey: 'devices.nav.devices', href: '/backend/devices' },
    { label: 'Edit Device', labelKey: 'devices.form.editTitle' },
  ],
}
