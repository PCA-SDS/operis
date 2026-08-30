import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'invoice',
  title: 'Invoice',
  version: '0.1.0',
  description: 'AP and AR invoice accounting contracts for Operis.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  defaultEntitlement: 'disabled',
}

export { features } from './acl'
