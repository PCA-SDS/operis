export const metadata = {
  requireAuth: true,
  requireFeatures: ['devices.admin'],
  pageTitle: 'Register Device',
  pageTitleKey: 'devices.form.createTitle',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Devices', labelKey: 'devices.nav.devices', href: '/backend/devices' },
    { label: 'Register Device', labelKey: 'devices.form.createTitle' },
  ],
}
