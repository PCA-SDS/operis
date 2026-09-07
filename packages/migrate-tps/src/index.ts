/**
 * @open-mercato/migrate-tps
 *
 * One-shot importer that seeds a tenant's catalog from the TPS service menu.
 * Client-specific data lives here rather than in @open-mercato/core so the
 * core package carries no single customer's catalogue.
 */

export { migrateTpsCategoriesCommand } from './modules/migrate_tps/categories.js'
export { migrateTpsProductsCommand } from './modules/migrate_tps/products.js'
export { SERVICE_MENU } from './modules/migrate_tps/data/serviceMenu.js'
export type { ServiceMenuData } from './modules/migrate_tps/data/types.js'
