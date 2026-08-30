import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'migrate_tps',
  title: 'TPS Catalog Import',
  version: '0.1.0',
  description: "One-shot importer that seeds a tenant's catalog from the TPS service menu. CLI only.",
  license: 'MIT',
  category: 'Administrative',
}

export { migrateTpsCategoriesCommand } from './categories'
export { migrateTpsProductsCommand } from './products'
export { SERVICE_MENU } from './data/serviceMenu'
export type { ServiceMenuData } from './data/types'
