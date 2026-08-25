export const metadata = {
  id: 'sync_excel',
  title: 'Excel / CSV Import',
  description: 'File-upload-based CSV import foundation built on top of the data sync hub.',
  requires: ['data_sync', 'integrations'],
  defaultEntitlement: 'enabled' as const,
}

export default metadata
