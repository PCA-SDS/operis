import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'appointments',
  title: 'Appointments',
  version: '0.1.0',
  description: 'Appointment booking intake (branch-scoped services, customer find-or-create, status catalog).',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['directory', 'customers', 'catalog'],
  ejectable: true,
  defaultEntitlement: 'enabled',
}

export { features } from './acl'
