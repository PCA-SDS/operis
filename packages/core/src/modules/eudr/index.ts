import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'eudr',
  title: 'EUDR Compliance',
  version: '0.1.0',
  description: 'EU Deforestation Regulation compliance: product commodity mappings, supplier origin evidence, due diligence statements.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  category: 'Compliance',
  aiAssistant: true,
}

export { features } from './acl'
