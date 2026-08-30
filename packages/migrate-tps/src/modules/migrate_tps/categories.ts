import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { SERVICE_MENU } from './data/serviceMenu'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { rebuildCategoryHierarchyForOrganization } from '@open-mercato/core/modules/catalog/lib/categoryHierarchy'
import { randomUUID } from 'crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseTpsMigrateFlags } from './lib'

const logger = createLogger('migrate_tps')

export const migrateTpsCategoriesCommand: ModuleCli = {
  command: 'categories',
  async run(rest) {
    const { tenantId, organizationId, replace } = parseTpsMigrateFlags(rest)
    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato migrate_tps categories <tenantId> <organizationId> [--replace]')
      throw new Error('Missing tenantId or organizationId')
    }

    const container = await createRequestContainer()
    try {
      const baseEm = container.resolve<EntityManager>('em').fork()
      
      logger.info(`Starting TPS Category migration for Tenant: ${tenantId}, Org: ${organizationId}`)

      const existingCount = await baseEm.count(CatalogProductCategory, { tenantId, organizationId })
      if (existingCount > 0) {
        if (!replace) {
          logger.error(`Found ${existingCount} existing categories for organization ${organizationId}.`)
          logger.error('Aborting. Use --replace to overwrite existing data.')
          throw new Error(`Existing categories already found for organization ${organizationId}`)
        }
        logger.info(`Found ${existingCount} existing categories. --replace flag is set, proceeding with cleanup...`)
      }

      await baseEm.transactional(async (em) => {
        if (existingCount > 0) {
          logger.info('Cleaning up existing categories for this organization...')
          await em.getConnection().execute(
            'DELETE FROM catalog_product_categories WHERE tenant_id = ? AND organization_id = ?',
            [tenantId, organizationId]
          )
          logger.info('Cleanup complete.')
        }


    const slugCounts = new Set<string>()
    function generateUniqueSlug(text: string): string {
      const baseSlug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '')

      let attempt = baseSlug
      let count = 1
      while (slugCounts.has(attempt)) {
        attempt = `${baseSlug}-${count}`
        count++
      }
      slugCounts.add(attempt)
      return attempt
    }

    let addedCategories = 0
    let addedSubcategories = 0
    const now = new Date()
    
    for (const [tabKey, tab] of Object.entries(SERVICE_MENU)) {
      // Create Parent Category (Tab)
        const parentId = randomUUID()
        const parentCat = em.create(CatalogProductCategory, {
          id: parentId,
          tenantId,
          organizationId,
          name: tab.label,
          slug: generateUniqueSlug(tab.label),
          depth: 0,
          ancestorIds: [],
          childIds: [],
          descendantIds: [],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        em.persist(parentCat)
        addedCategories++

        if (tab.categories && tab.categories.length > 0) {
          for (const childCat of tab.categories) {
            // Create Child Category
            const childId = randomUUID()
            const childEntity = em.create(CatalogProductCategory, {
              id: childId,
              tenantId,
              organizationId,
              name: childCat.label,
              slug: generateUniqueSlug(childCat.label),
              description: childCat.note || null,
              parentId: parentId,
              depth: 0,
              ancestorIds: [],
              childIds: [],
              descendantIds: [],
              isActive: true,
              metadata: {
                type: childCat.type,
                requirement: childCat.requirement,
                mode: childCat.mode,
                legacyId: childCat.id,
                itemsCount: childCat.items?.length || 0,
              },
              createdAt: now,
              updatedAt: now,
            })
            em.persist(childEntity)
            addedSubcategories++
          }
        }
      }

      logger.info('Flushing records to database...')
      await em.flush()

      logger.info('Rebuilding category hierarchy tree...')
      await rebuildCategoryHierarchyForOrganization(em, organizationId, tenantId)
      
      logger.info(`Migration successful! Created ${addedCategories} Root Categories and ${addedSubcategories} Subcategories.`)
      })
    } catch (err) {
      logger.error('An error occurred during Category migration', { err })
      throw err instanceof Error ? err : new Error('Category migration failed')
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}
