export const features = [
  { id: 'invoice.view', title: 'View invoices', module: 'invoice' },
  {
    id: 'invoice.manage',
    title: 'Manage invoices',
    module: 'invoice',
    dependsOn: ['invoice.view'],
  },
  {
    id: 'invoice.delete',
    title: 'Delete invoices',
    module: 'invoice',
    dependsOn: ['invoice.manage'],
  },
  {
    id: 'invoice.sync',
    title: 'Sync invoices',
    module: 'invoice',
    dependsOn: ['invoice.view'],
  },
  {
    id: 'invoice.settings.manage',
    title: 'Manage invoice settings',
    module: 'invoice',
    dependsOn: ['invoice.view'],
  },
  {
    id: 'invoice.payment_confirmations.manage',
    title: 'Manage invoice payment confirmations',
    module: 'invoice',
    dependsOn: ['invoice.manage'],
  },
  {
    id: 'invoice.ai.view',
    title: 'Use invoice AI assistant',
    module: 'invoice',
    dependsOn: ['invoice.view'],
  },
]

export default features
