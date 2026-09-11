export const features = [
  { id: 'email.templates.view', title: 'View email templates', module: 'email' },
  {
    id: 'email.templates.manage',
    title: 'Manage email templates',
    module: 'email',
    dependsOn: ['email.templates.view'],
  },
  {
    id: 'email.accounting_defaults.view',
    title: 'View accounting email defaults',
    module: 'email',
    dependsOn: ['email.templates.view'],
  },
  {
    id: 'email.accounting_defaults.manage',
    title: 'Manage accounting email defaults',
    module: 'email',
    dependsOn: ['email.accounting_defaults.view'],
  },
]

export default features
