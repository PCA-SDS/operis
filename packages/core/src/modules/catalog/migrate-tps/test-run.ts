import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { migrateTpsProductsCommand } from './products'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

async function run() {
  const { resolve } = await createRequestContainer()
  const em = resolve<EntityManager>('em').fork()
  
  // Find tenant
  const result = await em.getConnection().execute('SELECT id, organization_id FROM tenants LIMIT 1')
  if (!result || result.length === 0) {
    logger.error('No tenant found!')
    process.exit(1)
  }
  
  const tenantId = result[0].id
  const orgId = result[0].organization_id
  
  logger.info(`Found Tenant: ${tenantId}, Org: ${orgId}`)
  
  // Run migration
  await migrateTpsProductsCommand.run([tenantId, orgId, '--replace'])
  
  process.exit(0)
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
