import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'mcp',
  title: 'MCP Connections',
  version: '0.1.0',
  description:
    'OAuth 2.1 protected Model Context Protocol endpoint exposing a narrowly scoped slice of the ERP to MCP clients.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['auth'],
  defaultEntitlement: 'enabled',
}

export { features } from './acl'
